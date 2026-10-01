"use client";
import { useState } from "react";
import type { InputConfirmationView } from "../../server/input-confirmation";
import { publicationDays, radiusUnit } from "../../providers/search-policy";
import { request, useResource, errorText } from "./client";

export function NativeFilterPanel() {
  const data = useResource<InputConfirmationView>("admin/provider/filters");
  return (
    <article className="saas-panel">
      <h3>Filtros da busca</h3>
      <p>
        O período e o raio do radar precisam chegar à fonte sem substituições.
        Esta configuração é da administração, não do cliente.
      </p>
      <p>
        Consultar e salvar esta configuração não dispara uma coleta. Radares já
        ativados continuam sujeitos às autorizações e cotas existentes.
      </p>
      {data.error && (
        <p role="alert" className="saas-error">
          {data.error}
        </p>
      )}
      {!data.data && !data.error && (
        <p role="status">Consultando os campos da fonte…</p>
      )}
      {data.data && (
        <FilterForm
          key={
            data.data.baseFingerprint +
            ":" +
            (data.data.confirmation?.id ?? "none")
          }
          data={data.data}
          refresh={data.refresh}
        />
      )}
      <button type="button" onClick={data.refresh}>
        Atualizar configuração da fonte
      </button>
    </article>
  );
}
function FilterForm({
  data,
  refresh,
}: {
  data: InputConfirmationView;
  refresh: () => void;
}) {
  const date = data.fields.find((f) => f.name === "date_listed");
  const radius = data.fields.find((f) => f.name === "radius");
  const published =
    date?.enumPublished === true || date?.optionsSource === "metadata";
  const publishedUnit = radiusUnit(radius?.unit);
  const initial = (days: 1 | 7) =>
    String(
      (days === 1
        ? data.confirmation?.oneDayValue
        : data.confirmation?.sevenDayValue) ??
        date?.options?.find((v) => publicationDays(v) === days) ??
        "",
    );
  const [oneDay, setOneDay] = useState(initial(1));
  const [sevenDays, setSevenDays] = useState(initial(7));
  const [unit, setUnit] = useState(
    publishedUnit ?? data.confirmation?.radiusUnit ?? "",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dateField = (days: 1 | 7, value: string, set: (s: string) => void) => (
    <label className="saas-field">
      <span>Valor da fonte para {days === 1 ? "24 horas" : "7 dias"}</span>
      {published ? (
        <select value={value} onChange={(e) => set(e.target.value)}>
          <option value="">Não confirmado</option>
          {date?.options?.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          maxLength={80}
          onChange={(e) => set(e.target.value)}
          placeholder={
            days === 1
              ? "Ex.: Last 24 hours (confira no painel)"
              : "Ex.: Last 7 days (confira no painel)"
          }
        />
      )}
      <small>
        {published
          ? "Escolha um valor da lista publicada pela fonte."
          : "Copie o valor exato do exemplo de requisição da aba Configuração na Bright Data. O exemplo do campo não é uma confirmação."}
      </small>
    </label>
  );
  return (
    <>
      {data.stale && (
        <p role="alert" className="saas-note">
          O contrato da fonte mudou. A confirmação antiga não será reutilizada.
        </p>
      )}
      {!data.compatible && (
        <p role="alert">
          A fonte ainda não publicou um método de busca compatível.
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          try {
            const numeric = ["number", "integer"].includes(date?.type ?? "");
            const result = await request<InputConfirmationView>(
              "admin/provider/filters",
              {
                dataset: data.dataset,
                baseFingerprint: data.baseFingerprint,
                ...(oneDay.trim()
                  ? { oneDayValue: numeric ? Number(oneDay) : oneDay.trim() }
                  : {}),
                ...(sevenDays.trim()
                  ? {
                      sevenDayValue: numeric
                        ? Number(sevenDays)
                        : sevenDays.trim(),
                    }
                  : {}),
                ...(unit ? { radiusUnit: unit } : {}),
                confirmed,
              },
            );
            setMessage(
              result.example.issue ??
                "Confirmação salva. A próxima busca usará os critérios atuais do radar.",
            );
            refresh();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="saas-grid-two">
          {dateField(1, oneDay, setOneDay)}
          {dateField(7, sevenDays, setSevenDays)}
        </div>
        <label className="saas-field">
          <span>Unidade do campo radius na Bright Data</span>
          <select
            value={unit}
            disabled={!!publishedUnit}
            onChange={(e) => setUnit(e.target.value)}
          >
            <option value="">Selecione após conferir na fonte</option>
            <option value="km">Quilômetros (km)</option>
            <option value="miles">Milhas (mi)</option>
            <option value="m">Metros (m)</option>
          </select>
          <small>
            {publishedUnit
              ? "Unidade publicada na metadata. Não pode ser substituída."
              : "Não é a unidade do formulário do Radar: é a unidade aceita pela fonte. Sem essa confirmação, não omitimos nem adivinhamos o raio."}
          </small>
        </label>
        <label className="saas-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            required
          />
          Conferi os valores e a unidade na configuração da minha conta Bright
          Data.
        </label>
        <button disabled={busy || !confirmed || !data.compatible}>
          {busy ? "Salvando…" : "Salvar confirmação, sem coleta"}
        </button>
        {error && (
          <p role="alert" className="saas-error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </form>
      <details open>
        <summary>Prévia de verificação: 7 dias e 30 km</summary>
        <p>
          Exemplo local com iPhone 13 em Curitiba. Não é uma execução nem uma
          confirmação de disponibilidade de anúncios.
        </p>
        {data.example.input ? (
          <pre>{JSON.stringify(data.example.input, null, 2)}</pre>
        ) : (
          <p role="status">{data.example.issue}</p>
        )}
      </details>
    </>
  );
}
