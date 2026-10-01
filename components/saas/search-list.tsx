"use client";
import { customerReason } from "../../core/customer-copy";
import { intervalLabel } from "../../core/service-schedule";
import type { Bootstrap, SearchView } from "../../server/bootstrap";
import { useState } from "react";
import { request, errorText, money, when } from "./client";
export function SearchList({
  bootstrap: b,
  onEdit,
  onCreate,
  onRefresh,
}: {
  bootstrap: Bootstrap;
  onEdit: (m: SearchView) => void;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState<SearchView | null>(null),
    [notice, setNotice] = useState("");
  async function edit(m: SearchView, config: Record<string, unknown>) {
    setBusy(m.id);
    setError("");
    try {
      await request(`searches/${encodeURIComponent(m.id)}`, {
        config,
        expectedVersion: m.version ?? 0,
      });
      onRefresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function scan(m: SearchView) {
    setBusy(m.id);
    setError("");
    try {
      const r = await request<{ message: string }>("scan", {
        monitorId: m.id,
        confirmConsumption: true,
      });
      setNotice(r.message);
      setConfirm(null);
      onRefresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section>
      <div className="saas-section-head">
        <div>
          <h2>Meus radares</h2>
          <p>Seus critérios, horários e o que aconteceu em cada busca.</p>
        </div>
        <button className="saas-primary" onClick={onCreate}>
          Novo radar
        </button>
      </div>
      {error && (
        <p role="alert" className="saas-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!b.searches.length && (
        <div className="saas-empty">
          <h3>Crie seu primeiro radar</h3>
          <p>Escolha o produto, a cidade e o seu limite de compra.</p>
          <button onClick={onCreate}>Criar meu primeiro radar</button>
        </div>
      )}
      <div className="saas-search-list">
        {b.searches.map((m) => (
          <article key={m.id} className="saas-search-card">
            <div className="saas-section-head">
              <div>
                <h3>{m.name}</h3>
                <p>
                  {m.product || m.query} ·{" "}
                  {m.city || "Localização não definida"} · Até{" "}
                  {money(m.maxPrice)}
                </p>
              </div>
              <span className="saas-badge">
                {m.operational.status.replace(/_/g, " ")}
              </span>
            </div>
            <p aria-live="polite">{m.operational.message}</p>
            {m.operational.lastError && (
              <div className="saas-note" role="status">
                <strong>O que fazer</strong>
                <p>{m.operational.lastError.action}</p>
                {m.operational.lastError.technical && (
                  <details>
                    <summary>Motivo técnico desta tentativa</summary>
                    <p>{m.operational.lastError.technical}</p>
                    <p>
                      Etapa:{" "}
                      {m.operational.lastError.phase ?? "não identificada"}
                    </p>
                  </details>
                )}
                {m.operational.runId && (
                  <small>Execução: {m.operational.runId}</small>
                )}
              </div>
            )}
            {m.operational.snapshotId && (
              <p className="saas-muted">
                Resultado solicitado à fonte: {m.operational.snapshotId}
              </p>
            )}
            {m.operational.candidatesFound > 0 && (
              <p className="saas-note">
                A fonte retornou {m.operational.candidatesFound} links sem os
                detalhes do anúncio. Nenhuma coleta adicional paga foi iniciada.
                Consulte a administração antes de solicitar enriquecimento.
              </p>
            )}
            <dl className="saas-facts">
              <div>
                <dt>Última conclusão</dt>
                <dd>{when(m.operational.lastCompleted)}</dd>
              </div>
              <div>
                <dt>Próxima tentativa</dt>
                <dd>
                  {m.operational.nextAttempt
                    ? when(m.operational.nextAttempt)
                    : "Sem horário confirmado"}
                </dd>
              </div>
              <div>
                <dt>Intervalo mínimo efetivo</dt>
                <dd>{intervalLabel(m.operational.effectiveInterval)}</dd>
              </div>
            </dl>
            {m.operational.summary &&
              Object.keys(m.operational.summary).length > 0 && (
                <div className="saas-funnel">
                  <strong>Última execução</strong>
                  <span>{m.operational.summary.found ?? 0} recebidos</span>
                  <span>
                    {m.operational.summary.matched ?? 0} correspondentes
                  </span>
                  <span>
                    {m.operational.summary.withinBudget ?? 0} no orçamento
                  </span>
                  <span>
                    {m.operational.summary.qualified ?? 0} aprovados para
                    revenda
                  </span>
                  {Object.entries(m.operational.summary.primaryReasons ?? {})
                    .sort((a, b) => Number(b[1]) - Number(a[1]))
                    .slice(0, 3)
                    .map(([reason, count]) => (
                      <span key={reason}>
                        {customerReason(reason)}: {String(count)}
                      </span>
                    ))}
                </div>
              )}
            <div className="saas-actions">
              <button onClick={() => onEdit(m)} disabled={busy === m.id}>
                Revisar critérios
              </button>
              <button
                onClick={() =>
                  void edit(m, { active: !m.active, archived: false })
                }
                disabled={busy === m.id || b.account.status !== "active"}
              >
                {m.active ? "Pausar" : "Ativar"}
              </button>
              <button
                onClick={() =>
                  void edit(m, { archived: !m.archived, active: false })
                }
                disabled={busy === m.id}
              >
                {m.archived ? "Desarquivar" : "Arquivar"}
              </button>
              <button
                onClick={() => setConfirm(m)}
                disabled={
                  !m.active ||
                  !!m.archived ||
                  busy === m.id ||
                  !b.service.ready ||
                  !b.service.collectionEnabled ||
                  b.service.quotaPaused ||
                  m.operational.status === "buscando"
                }
              >
                Buscar agora
              </button>
            </div>
            {confirm?.id === m.id && (
              <div
                className="saas-note"
                role="region"
                aria-label="Confirmar consumo"
              >
                <p>
                  A execução pode consumir uma unidade da sua cota e da cota
                  global da fonte. Até{" "}
                  {Math.min(m.resultsPerSearch ?? 10, b.service.maxRecords)}{" "}
                  registros solicitados, sem garantia de resultados úteis.
                </p>
                <button onClick={() => void scan(m)} disabled={busy === m.id}>
                  Confirmar solicitação
                </button>{" "}
                <button onClick={() => setConfirm(null)}>Cancelar</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
