"use client";
import { useId, useState } from "react";
import { DEFAULT_SETTINGS, type Monitor } from "../../core/types";
import { normalize } from "../../core/normalize";
import { financialCeilingFor } from "../../core/purchase-policy";
import { intervalLabel } from "../../core/service-schedule";
import { automaticQueries } from "../../core/query-strategy";
import { catalogExamples } from "../../core/catalog";
import type { Bootstrap } from "../../server/bootstrap";
import { ApiError, request, errorText, money } from "./client";
export interface Draft {
  requestKey?: string;
  step: number;
  values: Record<string, unknown>;
}
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
    [advanced, setAdvanced] = useState(false),
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
  const costs = (v.costs as Record<string, number> | undefined) ?? {
    transport: 0,
    maintenance: 0,
    cleaning: 0,
    packaging: 0,
    other: 0,
    feePct: 0,
    fuel: 0,
    commissionPct: 0,
  };
  const setCost = (name: string, n: number) =>
    set("costs", { ...costs, [name]: n });
  const ceiling = financialCeilingFor(
    Number(v.expectedQuickSalePrice) > 0
      ? Number(v.expectedQuickSalePrice)
      : null,
    {
      ...DEFAULT_SETTINGS,
      ...costs,
      minRoi: Number(v.minRoi ?? DEFAULT_SETTINGS.minRoi),
    },
    Number(v.minProfit ?? 0),
  );
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
      (allSteps || step === 2) &&
      (!Number.isFinite(numeric("maxPrice")) || numeric("maxPrice") <= 0)
    )
      f.maxPrice = "Informe um limite de compra maior que zero.";
    if (
      (allSteps || step === 2) &&
      !personal &&
      v.mode === "manual" &&
      Number(v.expectedQuickSalePrice) <= 0
    )
      f.expectedQuickSalePrice =
        "Informe a hipótese de venda ou use avaliação automática.";
    setFields(f);
    return Object.keys(f).length === 0;
  };
  const submit = async () => {
    if (!validation(true)) {
      setError("Revise os campos das etapas anteriores antes de salvar.");
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
        step={type === "number" ? "0.01" : undefined}
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
          <p className="saas-eyebrow">
            {monitor ? "EDITAR BUSCA" : "SUA PRÓXIMA OPORTUNIDADE"}
          </p>
          <h2 id={`${id}-title`}>
            {
              [
                "O que você quer encontrar?",
                "Onde você quer comprar?",
                "Quanto você aceita pagar?",
                "Revise e escolha seus avisos",
              ][step]
            }
          </h2>
        </div>
        <button onClick={onClose} disabled={busy} type="button">
          Voltar ao painel
        </button>
      </div>
      <ol className="saas-steps" aria-label="Progresso">
        {["Produto", "Região", "Orçamento", "Avisos"].map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined}>
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 3) {
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
                  "personal",
                  "Comprar para mim",
                  "Encontre um anúncio no seu orçamento.",
                ],
                [
                  "resale",
                  "Comprar para revender",
                  "Avalie custos e lucro estimado antes de comprar.",
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
              <span>Produto e versão desejada</span>
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
                placeholder="Ex.: iPhone 15 128 GB ou Fifine A8"
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
                  (product.support === "supported"
                    ? `Identificação disponível: ${product.model}. A estimativa de preço depende de comparáveis.`
                    : product.support === "partial"
                      ? "Modelo parcialmente identificado. Vamos buscar por termos e orçamento, sem tratar a estimativa como comprovada."
                      : "Busca por termos e orçamento. Não prometemos avaliação automática para produtos fora do catálogo.")}
              </small>
            </label>
            <div className="saas-note">
              <strong>{product.model || "Busca por descrição"}</strong>
              <p>
                {product.model
                  ? personal
                    ? `Procuraremos exatamente este modelo${product.storage ? ` de ${product.storage}` : ""}. Outras versões não são incluídas.`
                    : `Procuraremos este modelo${product.storage ? ` de ${product.storage}` : ""} e versões superiores da mesma linha (ex.: Pro, Pro Max ou geração mais nova), desde que dentro do seu teto de preço.`
                  : "Variações de escrita serão consideradas, sem estimar revenda quando não houver dados suficientes."}
              </p>
            </div>
            <label className="saas-field">
              <span>Anúncios publicados</span>
              <select
                value={
                  Number(v.maxListingAgeMinutes || 10080) <= 1440
                    ? "1440"
                    : "10080"
                }
                onChange={(e) =>
                  set("maxListingAgeMinutes", Number(e.target.value))
                }
              >
                <option value="10080">Nos últimos 7 dias</option>
                <option value="1440">Nas últimas 24 horas</option>
              </select>
              <small>
                {personal
                  ? "Não mostramos anúncios antigos ou sem data confirmada nas oportunidades."
                  : "Anúncios com data comprovadamente antiga ficam de fora. Quando o Facebook não informa a data, mostramos assim mesmo, marcados como “data não confirmada” para você conferir no anúncio."}
              </small>
            </label>
            <label className="saas-field">
              <span>Condição aceitável</span>
              <select
                value={value("condition")}
                onChange={(e) => set("condition", e.target.value)}
              >
                {[
                  ["working", "Funcionando, sem defeito importante informado"],
                  ["any", "Novo ou usado, funcionando"],
                  ["new", "Novo ou lacrado"],
                  ["excellent", "Excelente estado"],
                  ["used", "Usado"],
                  ["damaged", "Com defeito, para avaliar reparo"],
                ].map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
              <small>
                As descrições são declarações do vendedor, não uma vistoria.
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
            {field(
              "radiusKm",
              "Distância desejada (km)",
              "number",
              "O raio é solicitado à fonte quando suportado. Sem coordenadas verificáveis, mostramos somente a cidade escolhida.",
            )}
            <p className="saas-muted">
              Sua região fica salva para os próximos radares. Não ampliaremos a
              área automaticamente.
            </p>
          </>
        )}
        {step === 2 && (
          <>
            {field(
              "maxPrice",
              "Máximo que você aceita pagar (R$)",
              "number",
              "Este teto não será aumentado automaticamente.",
            )}
            {!personal && (
              <>
                <div className="saas-grid-two">
                  {field(
                    "expectedQuickSalePrice",
                    "Hipótese de revenda (R$)",
                    "number",
                    "Opcional. É sua hipótese, não uma venda comprovada.",
                  )}
                  {field(
                    "minProfit",
                    "Lucro líquido mínimo desejado (R$)",
                    "number",
                  )}
                </div>
                <details>
                  <summary>Custos e retorno desejado</summary>
                  <div className="saas-grid-two">
                    {Object.entries({
                      transport: "Transporte",
                      maintenance: "Reparo",
                      cleaning: "Limpeza",
                      packaging: "Embalagem",
                      other: "Outros custos",
                      fuel: "Combustível",
                      feePct: "Taxa de venda (%)",
                      commissionPct: "Comissão (%)",
                    }).map(([k, label]) => (
                      <label className="saas-field" key={k}>
                        <span>{label}</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={costs[k] ?? 0}
                          onChange={(e) => setCost(k, Number(e.target.value))}
                        />
                      </label>
                    ))}
                    {field(
                      "minRoi",
                      "Retorno mínimo sobre compra (%)",
                      "number",
                    )}
                  </div>
                  <p>
                    Custos inicialmente zerados são editáveis. Confira os seus
                    antes de usar o lucro estimado.
                  </p>
                </details>
                <div className="saas-note">
                  {ceiling !== null ? (
                    <>
                      Teto financeiro segundo sua hipótese:{" "}
                      <strong>{money(Math.floor(ceiling * 100) / 100)}</strong>.
                      O limite final também respeita o máximo de compra que você
                      informou.
                    </>
                  ) : (
                    <>
                      Sem hipótese manual, a estimativa depende de amostra
                      compatível e suficiente.
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <div className="saas-review">
              <strong>{value("product") || value("query")}</strong>
              <span>
                {value("city")} · Até {money(numeric("maxPrice"))}
              </span>
              <span>
                {personal ? "Compra para uso próprio" : "Compra para revenda"} ·{" "}
                {product.model
                  ? "Produto identificado"
                  : "Busca genérica por orçamento"}
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
                Novos anúncios observados após a ativação
              </label>
              <label className="saas-check">
                <input
                  type="checkbox"
                  checked={v.notifyDrops !== false}
                  onChange={(e) => set("notifyDrops", e.target.checked)}
                />
                Quedas de preço observadas
              </label>
            </fieldset>
            <p>
              A primeira seleção aparece aqui assim que a pesquisa terminar.
              Você pode sair da tela enquanto procuramos.
            </p>
            <p>
              <strong>Canal:</strong> avisos dentro do painel
              {b.account.telegram?.enabled
                ? " e Telegram verificado"
                : ". O Telegram pode ser vinculado em Conta quando habilitado"}
              .
            </p>
            <p>
              <strong>Frequência efetiva mínima:</strong>{" "}
              {intervalLabel(
                monitor
                  ? (b.searches.find((m) => m.id === monitor.id)?.operational
                      .effectiveInterval ?? b.service.newRadarInterval)
                  : b.service.newRadarInterval,
              )}{" "}
              entre pesquisas, quando o acompanhamento automático estiver
              habilitado. Cotas e disponibilidade podem adiar a próxima
              tentativa.
            </p>
            <div className="saas-note">
              {!b.service.ready || !b.service.collectionEnabled
                ? "A busca será salva. A execução depende da habilitação administrativa da fonte."
                : b.service.pilot
                  ? "Ao ativar, autorizo a primeira pesquisa dentro da minha cota. Neste ambiente de teste, as próximas atualizações continuam manuais."
                  : "Ao ativar, autorizo a primeira pesquisa e o acompanhamento dentro da minha cota. Posso pausar quando quiser."}
            </div>
            <label className="saas-check">
              <input
                type="checkbox"
                checked={v.active !== false}
                onChange={(e) => set("active", e.target.checked)}
              />
              Manter esta busca ativa
            </label>
          </>
        )}
        <button
          className="saas-text-button"
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? "Ocultar" : "Mostrar"} opções avançadas
        </button>
        {advanced && (
          <div className="saas-advanced">
            {field("name", "Nome da busca")}
            <p>
              Variações do nome são preparadas automaticamente, sem incluir
              outros modelos.
            </p>
            {field(
              "minPrice",
              "Preço mínimo aceitável (R$)",
              "number",
              "Opcional. Preço muito baixo também pode exigir atenção.",
            )}
            {field(
              "maxRisk",
              "Quanto cuidado aplicar (0 a 100)",
              "number",
              "Indicador dos pontos a conferir. Não é uma chance de golpe ou uma garantia.",
            )}
            {!personal && (
              <>
                {field("minScore", "Pontuação mínima da análise", "number")}
                {field(
                  "strongPrice",
                  "Limite para compra forte (R$)",
                  "number",
                )}
                {field(
                  "ultraPrice",
                  "Limite para compra excepcional (R$)",
                  "number",
                )}
              </>
            )}
            <label className="saas-field">
              <span>Termos excluídos, separados por vírgula</span>
              <input
                value={((v.negatives as string[]) ?? []).join(", ")}
                onChange={(e) =>
                  set(
                    "negatives",
                    e.target.value.split(",").map((s) => s.trim()),
                  )
                }
              />
            </label>
            <label className="saas-field">
              <span>Como interpretar as exclusões</span>
              <select
                value={value("negativeMode") || "contextual"}
                onChange={(e) => set("negativeMode", e.target.value)}
              >
                <option value="contextual">
                  Contextual: preserva negações reconhecidas e acessórios
                  incluídos
                </option>
                <option value="literal">
                  Literal: descarta qualquer ocorrência do termo
                </option>
              </select>
            </label>
            <label className="saas-field">
              <span>Método de busca</span>
              <select
                value={value("queryType") || "keyword"}
                onChange={(e) => set("queryType", e.target.value)}
              >
                <option value="keyword">Por produto e termos</option>
                <option value="search_url">
                  URL de uma pesquisa do Marketplace
                </option>
              </select>
            </label>
            {v.queryType === "search_url" &&
              field(
                "searchUrl",
                "URL de resultados da pesquisa",
                "url",
                "Não use o link de um anúncio individual.",
              )}
            {field(
              "intervalSeconds",
              "Intervalo solicitado (segundos)",
              "number",
              `Mínimo efetivo: ${b.account.plan.minInterval} segundos.`,
            )}
            {!personal && (
              <label className="saas-field">
                <span>Referência de revenda</span>
                <select
                  value={value("mode")}
                  onChange={(e) => set("mode", e.target.value)}
                >
                  <option value="combined">
                    Conservadora: menor valor entre hipótese e comparáveis
                  </option>
                  <option value="automatic">
                    Somente comparáveis suficientes
                  </option>
                  <option value="manual">Hipótese informada por mim</option>
                </select>
              </label>
            )}
            <p>Campos legados não apresentados serão preservados ao editar.</p>
          </div>
        )}
        {Object.entries(fields)
          .filter(
            ([key]) =>
              ![
                "product",
                "city",
                "maxPrice",
                "expectedQuickSalePrice",
              ].includes(key),
          )
          .map(
            ([k, msg]) =>
              msg && (
                <p role="alert" className="saas-error" key={k}>
                  {k}: {msg}
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
              : step === 3
                ? monitor
                  ? "Salvar alterações"
                  : v.active === false
                    ? "Salvar radar pausado"
                    : "Ativar radar e buscar"
                : "Continuar"}
          </button>
        </div>
      </form>
    </section>
  );
}
