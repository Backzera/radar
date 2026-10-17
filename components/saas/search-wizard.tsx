"use client";
import { useId, useState } from "react";
import type { Monitor } from "../../core/types";
import { normalize } from "../../core/normalize";
import { automaticQueries } from "../../core/query-strategy";
import { catalogExamples } from "../../core/catalog";
import type { Bootstrap } from "../../server/bootstrap";
import { ApiError, request, errorText, money } from "./client";
export interface Draft {
  requestKey?: string;
  step: number;
  values: Record<string, unknown>;
}
// Mantém defaults sensatos para os campos que não aparecem mais no formulário
// simples (cuidado, pontuação, intervalo, modo de revenda, etc.). O usuário vê
// só o essencial; esses valores seguem sendo enviados ao salvar.
export function initialSearchValues(
  m: Monitor | undefined,
  b: Bootstrap,
  draft?: Draft,
) {
  const base = m
    ? {
        ...m,
        intent: m.intent ?? "resale",
        negativeMode: m.negativeMode ?? "literal",
      }
    : {
        name: "",
        product: "",
        query: "",
        intent: b.account.preferences.intent ?? "resale",
        identificationMode: "catalog",
        negativeMode: "contextual",
        negatives: [],
        city: b.account.preferences.city ?? "",
        radiusKm: b.account.preferences.radiusKm ?? 30,
        maxListingAgeMinutes: 10080,
        maxPrice: 0,
        minPrice: 0,
        maxRisk: 35,
        minScore: 65,
        minRoi: 20,
        condition: "working",
        active: true,
        mode: "combined",
        intervalSeconds: Math.max(b.account.plan.minInterval, 300),
        resultsPerSearch: Math.min(b.service.maxRecords, 25),
        includeUndated: true,
        notifyNew: b.account.preferences.notifyNew ?? true,
        notifyDrops: b.account.preferences.notifyDrops ?? true,
      };
  return { ...base, ...(!m ? draft?.values : {}) };
}
const STEP_TITLES = [
  "O que você quer encontrar?",
  "Onde e por quanto?",
  "Ative e seja o primeiro",
];
const STEP_LABELS = ["Produto", "Preço e local", "Avisos"];
const LAST_STEP = 2;
export function SearchWizard({
  bootstrap: b,
  monitor,
  draft,
  onClose,
  onSaved,
}: {
  bootstrap: Bootstrap;
  monitor?: Monitor;
  draft?: Draft;
  onClose: () => void;
  onSaved: (monitorId: string) => void;
}) {
  const [v, setV] = useState<Record<string, unknown>>(() =>
      initialSearchValues(monitor, b, draft),
    ),
    [step, setStep] = useState(monitor ? 0 : (draft?.step ?? 0)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState(""),
    [key] = useState(() => draft?.requestKey ?? crypto.randomUUID());
  const id = useId();
  const set = (name: string, value: unknown) => {
    setV((p) => ({ ...p, [name]: value }));
    setFields((p) => ({ ...p, [name]: "" }));
  };
  const value = (name: string) => String(v[name] ?? ""),
    numeric = (name: string) => Number(v[name] ?? 0);
  const product = normalize({
    title: value("product") || value("query"),
    description: "",
  });
  const personal = v.intent === "personal";
  const validation = (allSteps = false) => {
    const f: Record<string, string> = {};
    if (
      (allSteps || step === 0) &&
      (value("product") || value("query")).trim().length < 2
    )
      f.product = "Informe o produto que você procura.";
    if ((allSteps || step === 1) && value("city").trim().length < 2)
      f.city = "Informe a cidade para a busca.";
    if (
      (allSteps || step === 1) &&
      (!Number.isFinite(numeric("maxPrice")) || numeric("maxPrice") <= 0)
    )
      f.maxPrice = "Informe um preço máximo maior que zero.";
    if (
      (allSteps || step === 1) &&
      numeric("minPrice") > 0 &&
      numeric("maxPrice") > 0 &&
      numeric("minPrice") >= numeric("maxPrice")
    )
      f.minPrice = "O preço mínimo deve ser menor que o máximo.";
    setFields(f);
    return Object.keys(f).length === 0;
  };
  const submit = async () => {
    if (!validation(true)) {
      setError("Revise os campos antes de salvar.");
      setStep(0);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const config = {
        ...v,
        product: (value("product") || value("query")).trim(),
        query: automaticQueries(value("product") || value("query"))[0],
        maxListingAgeMinutes: Math.min(
          Number(v.maxListingAgeMinutes || 10080),
          10080,
        ),
        name: value("name") || value("product") || value("query"),
        identificationMode:
          monitor && value("product") === (monitor.product ?? "")
            ? (monitor.identificationMode ?? "catalog")
            : product.model
              ? "catalog"
              : "generic",
        negatives: ((v.negatives as string[]) ?? [])
          .map((x) => x.trim())
          .filter(Boolean),
        aliases: automaticQueries(value("product") || value("query")).slice(1),
      };
      for (const k of ["id", "version", "revision", "operational"])
        delete (config as Record<string, unknown>)[k];
      if (!monitor)
        await request("draft", { step, values: v, requestKey: key });
      const saved = await request<{ monitor: { id: string } }>(
        monitor ? `searches/${encodeURIComponent(monitor.id)}` : "searches",
        {
          config,
          activate: !monitor && v.active !== false,
          ...(monitor
            ? { expectedVersion: monitor.version ?? 0 }
            : { requestKey: key }),
        },
      );
      if (!monitor) await request("draft/delete", {});
      onSaved(saved.monitor.id);
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError)
        setFields(
          Object.fromEntries(
            e.fields.map((f) => [f.path.replace(/^config\./, ""), f.message]),
          ),
        );
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = async () => {
    setBusy(true);
    setError("");
    try {
      await request("draft", { step, values: v, requestKey: key });
      setNotice("Rascunho salvo. Você pode continuar depois.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const field = (name: string, label: string, type = "text", hint?: string) => (
    <label className="saas-field" key={name} htmlFor={`${id}-${name}`}>
      <span>{label}</span>
      <input
        id={`${id}-${name}`}
        type={type}
        value={value(name)}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "1" : undefined}
        onChange={(e) =>
          set(
            name,
            type === "number"
              ? e.target.value === ""
                ? null
                : Number(e.target.value)
              : e.target.value,
          )
        }
        aria-invalid={!!fields[name]}
        aria-describedby={`${id}-${name}-hint`}
      />
      <small id={`${id}-${name}-hint`}>{fields[name] || hint}</small>
    </label>
  );
  return (
    <section className="saas-wizard" aria-labelledby={`${id}-title`}>
      <div className="saas-section-head">
        <div>
          <p className="saas-eyebrow">{monitor ? "EDITAR RADAR" : "NOVO RADAR"}</p>
          <h2 id={`${id}-title`}>{STEP_TITLES[step]}</h2>
        </div>
        <button onClick={onClose} disabled={busy} type="button">
          Voltar ao painel
        </button>
      </div>
      <ol className="saas-steps" aria-label="Progresso">
        {STEP_LABELS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined}>
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step < LAST_STEP) {
            if (validation()) setStep((s) => s + 1);
          } else void submit();
        }}
      >
        {step === 0 && (
          <>
            <fieldset className="saas-intent">
              <legend>Qual é o seu objetivo?</legend>
              {[
                [
                  "resale",
                  "Comprar para revender",
                  "Mostra também modelos superiores dentro do seu preço.",
                ],
                [
                  "personal",
                  "Comprar para mim",
                  "Encontra exatamente o modelo que você pediu.",
                ],
              ].map(([intent, label, help]) => (
                <label
                  key={intent}
                  className={v.intent === intent ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name="intent"
                    value={intent}
                    checked={v.intent === intent}
                    onChange={() => set("intent", intent)}
                  />
                  <strong>{label}</strong>
                  <small>{help}</small>
                </label>
              ))}
            </fieldset>
            <label className="saas-field" htmlFor={`${id}-product`}>
              <span>O que você procura?</span>
              <input
                id={`${id}-product`}
                list={`${id}-catalog`}
                value={value("product")}
                onChange={(e) => {
                  set("product", e.target.value);
                  if (
                    !monitor ||
                    !value("query") ||
                    value("query") === value("product")
                  )
                    set("query", e.target.value);
                }}
                placeholder="Ex.: iPhone 11, PS5, Fifine A8"
                aria-invalid={!!fields.product}
                aria-describedby={`${id}-support`}
              />
              <datalist id={`${id}-catalog`}>
                {catalogExamples.map((example) => (
                  <option key={example} value={example} />
                ))}
              </datalist>
              <small id={`${id}-support`}>
                {fields.product ||
                  (product.model
                    ? personal
                      ? `Vamos procurar exatamente ${product.model}.`
                      : `Vamos procurar ${product.model} e versões superiores da mesma linha, dentro do seu preço.`
                    : "Busca por termos. Escreva o produto como aparece nos anúncios.")}
              </small>
            </label>
          </>
        )}
        {step === 1 && (
          <>
            <label className="saas-field" htmlFor={`${id}-city`}>
              <span>Cidade</span>
              <input
                id={`${id}-city`}
                list={`${id}-cities`}
                value={value("city")}
                onChange={(e) => set("city", e.target.value)}
                placeholder="Ex.: Curitiba"
                required
                aria-invalid={!!fields.city}
              />
              <datalist id={`${id}-cities`}>
                {[
                  "Curitiba",
                  "São José dos Pinhais",
                  "Colombo",
                  "Pinhais",
                  "Araucária",
                  "Joinville",
                  "Florianópolis",
                  "São Paulo",
                  "Rio de Janeiro",
                  "Belo Horizonte",
                  "Porto Alegre",
                  "Brasília",
                  "Salvador",
                  "Fortaleza",
                  "Recife",
                  "Belém",
                  "Manaus",
                ].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {fields.city && <small role="alert">{fields.city}</small>}
            </label>
            <div className="saas-grid-two">
              {field(
                "minPrice",
                "Preço mínimo (R$)",
                "number",
                "Opcional. Ajuda a cortar anúncios bons demais para ser verdade.",
              )}
              {field(
                "maxPrice",
                "Preço máximo (R$)",
                "number",
                "O teto que você aceita pagar.",
              )}
            </div>
            <p className="saas-muted">
              Só mostramos anúncios dentro dessa faixa de preço, na sua cidade.
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <div className="saas-review">
              <strong>{value("product") || value("query")}</strong>
              <span>
                {value("city")} ·{" "}
                {numeric("minPrice") > 0
                  ? `${money(numeric("minPrice"))} a ${money(numeric("maxPrice"))}`
                  : `Até ${money(numeric("maxPrice"))}`}
              </span>
              <span>
                {personal
                  ? "Compra para uso próprio"
                  : "Compra para revenda · inclui modelos superiores no preço"}
              </span>
            </div>
            <fieldset>
              <legend>Quando avisar?</legend>
              <label className="saas-check">
                <input
                  type="checkbox"
                  checked={v.notifyNew !== false}
                  onChange={(e) => set("notifyNew", e.target.checked)}
                />
                Novos anúncios assim que aparecerem
              </label>
              <label className="saas-check">
                <input
                  type="checkbox"
                  checked={v.notifyDrops !== false}
                  onChange={(e) => set("notifyDrops", e.target.checked)}
                />
                Quando um preço cair
              </label>
            </fieldset>
            <div className="saas-note">
              O radar fica de olho e te avisa assim que um anúncio novo dentro do
              seu preço aparecer — para você ser o primeiro a chamar o vendedor.
            </div>
            <label className="saas-check">
              <input
                type="checkbox"
                checked={v.active !== false}
                onChange={(e) => set("active", e.target.checked)}
              />
              Manter este radar ligado
            </label>
          </>
        )}
        {Object.entries(fields)
          .filter(
            ([key]) =>
              !["product", "city", "maxPrice", "minPrice"].includes(key),
          )
          .map(
            ([k, msg]) =>
              msg && (
                <p role="alert" className="saas-error" key={k}>
                  {msg}
                </p>
              ),
          )}
        {error && (
          <p role="alert" className="saas-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="saas-actions">
          {step > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep((s) => s - 1)}
            >
              Anterior
            </button>
          )}
          {!monitor && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveDraft()}
            >
              Salvar rascunho
            </button>
          )}
          <button className="saas-primary" type="submit" disabled={busy}>
            {busy
              ? "Salvando…"
              : step === LAST_STEP
                ? monitor
                  ? "Salvar alterações"
                  : v.active === false
                    ? "Salvar radar pausado"
                    : "Ativar radar e avisar"
                : "Continuar"}
          </button>
        </div>
      </form>
    </section>
  );
}
