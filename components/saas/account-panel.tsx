"use client";
import { useState } from "react";
import type { QualitySummary } from "../../server/quality";
import type { Bootstrap } from "../../server/bootstrap";
import type { Alert, Purchase } from "../../core/types";
import { purchaseOutcome } from "../../core/trading";
import { request, useResource, errorText, money, when } from "./client";
export function AccountPanel({
  bootstrap: b,
  onRefresh,
}: {
  bootstrap: Bootstrap;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [intent, setIntent] = useState(b.account.preferences.intent ?? "personal"),
    [notice, setNotice] = useState(""),
    [notifyNew, setNotifyNew] = useState(
      b.account.preferences.notifyNew ?? true,
    ),
    [notifyDrops, setNotifyDrops] = useState(
      b.account.preferences.notifyDrops ?? true,
    );
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onRefresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Sua conta</h2>
      <p>Preferências, avisos e os limites reais do seu acesso.</p>
      <div className="saas-grid-two">
        <article className="saas-panel">
          <h3>{b.account.plan.name}</h3>
          <p>Estado: {b.account.status === "active" ? "Ativo" : "Cancelado"}</p>
          <p>
            {b.account.usedToday} de {b.account.plan.dailyTriggers} solicitações
            da sua cota usadas hoje.
          </p>
          <p>
            Renovação: {when(b.account.resetsAt)}. O limite global da fonte
            também se aplica.
          </p>
          <p>
            Até {b.account.plan.maxActive} radares ativos. A frequência de cada
            radar é mostrada em Meus radares e considera a cota disponível; não
            é uma promessa de atualização a cada poucos minutos.
          </p>
          <div className="saas-note">
            {b.account.billing.reason} Não há checkout ou pagamento automático
            neste ambiente.
          </div>
        </article>
        <article className="saas-panel">
          <h3>Avisos</h3>
          <p>Os avisos internos aparecem no painel.</p>
          <p>
            Telegram:{" "}
            {b.account.telegram?.enabled
              ? "Vinculado e verificado"
              : b.account.plan.telegram
                ? "Não vinculado"
                : "Não habilitado neste acesso"}
            .
          </p>
          {b.account.plan.telegram && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () =>
                    setLink(await request("channels/telegram/link", {})),
                  )
                }
              >
                Vincular Telegram
              </button>
              {b.account.telegram?.enabled && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(() => request("channels/telegram/disconnect", {}))
                  }
                >
                  Desconectar Telegram
                </button>
              )}
            </>
          )}
          {link && (
            <div className="saas-note">
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                Abrir bot e confirmar vínculo
              </a>
              <p>
                O link expira em {when(link.expiresAt)}. Após iniciar o bot,
                atualize o painel. Nenhuma credencial será pedida no chat.
              </p>
              <button onClick={onRefresh}>Conferir conexão</button>
            </div>
          )}
        </article>
      </div>
      <form
        className="saas-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await request("preferences", {
              intent,
              notifyNew: true,
              notifyDrops: true,
            });
            setNotice(
              "Preferência salva para novas buscas. Buscas existentes não foram alteradas.",
            );
          });
        }}
      >
        <h3>Objetivo padrão para novas buscas</h3>
        <label className="saas-field">
          <span>Como você usa o radar?</span>
          <select value={intent} onChange={(e) => setIntent(e.target.value)}>
            <option value="personal">Comprar para mim</option>
            <option value="resale">Comprar para revender</option>
          </select>
        </label>
        <label className="saas-check">
          <input
            type="checkbox"
            checked={notifyNew}
            onChange={(e) => setNotifyNew(e.target.checked)}
          />
          Avisar novos anúncios em novas buscas
        </label>
        <label className="saas-check">
          <input
            type="checkbox"
            checked={notifyDrops}
            onChange={(e) => setNotifyDrops(e.target.checked)}
          />
          Avisar quedas de preço em novas buscas
        </label>
        <button disabled={busy}>Salvar preferência</button>
      </form>
      <details className="saas-panel">
        <summary>Exportar dados e cancelar acesso</summary>
        <p>
          Baixe seus registros em JSON. A exportação reúne páginas autenticadas
          da sua própria conta. Não exclui dados.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const exported: Record<string, unknown> = {
                account: b.account,
                createdAt: new Date().toISOString(),
                snapshot:
                  "Páginas consultadas sequencialmente; alterações simultâneas podem aparecer em momentos diferentes.",
              };
              for (const section of [
                "searches",
                "listings",
                "purchases",
                "feedback",
              ]) {
                const rows: unknown[] = [];
                let page = 1;
                while (true) {
                  const part = await request<{
                    items: unknown[];
                    hasNext: boolean;
                  }>(`account/export?section=${section}&page=${page}&limit=50`);
                  rows.push(...part.items);
                  setNotice(`Exportando ${section}: ${rows.length} registros…`);
                  if (!part.hasNext) break;
                  if (page++ >= 100000)
                    throw new Error(
                      "Exportação excedeu o limite. Solicite assistência administrativa.",
                    );
                  // Keep below the per-account HTTP rate limit without disabling it.
                  await new Promise((resolve) => setTimeout(resolve, 650));
                }
                exported[section] = rows;
              }
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(exported, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "meus-dados-market-radar.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              setNotice("Exportação concluída.");
            })
          }
        >
          Exportar meus dados
        </button>
        <p>
          Exclusão permanente ainda requer atendimento administrativo. O
          cancelamento abaixo não apaga o histórico.
        </p>
        <p>
          Cancelar pausa suas buscas e desativa os canais. Não apaga seu
          histórico nem representa cancelamento de cobrança em serviços
          externos.
        </p>
        <label className="saas-field">
          <span>Digite CANCELAR ACESSO para confirmar</span>
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        <button
          disabled={
            busy ||
            confirmation !== "CANCELAR ACESSO" ||
            b.account.status === "canceled"
          }
          onClick={() =>
            void act(() => request("account/cancel", { confirmation }))
          }
        >
          Cancelar meu acesso
        </button>
      </details>
      {error && (
        <p role="alert" className="saas-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {b.session.signOut ? (
        <a href={b.session.signOut}>Sair da conta</a>
      ) : (
        <p>
          Ambiente de desenvolvimento local. Não existe sessão externa para
          encerrar.
        </p>
      )}
    </section>
  );
}
export function AlertsPanel() {
  const [page, setPage] = useState(1),
    r = useResource<{
      items: (Alert & { delivery?: string })[];
      total: number;
    }>(`alerts?page=${page}&limit=25`),
    [error, setError] = useState("");
  return (
    <section>
      <div className="saas-section-head">
        <div>
          <h2>Avisos</h2>
          <p>
            Novidades e quedas de preço que passaram pelos critérios da busca.
          </p>
        </div>
        <button
          onClick={() =>
            void request("alerts/read", {})
              .then(r.refresh)
              .catch((e) => setError(errorText(e)))
          }
        >
          Marcar todos como lidos
        </button>
      </div>
      {r.loading && <p role="status">Carregando…</p>}
      {(r.error || error) && (
        <p role="alert" className="saas-error">
          {r.error || error}
        </p>
      )}
      {r.data?.items.length === 0 && (
        <div className="saas-empty">
          <h3>Nenhum aviso nesta página</h3>
          <p>
            A busca inicial não é anunciada como novidade. Os resultados
            iniciais ficam em Resultados.
          </p>
        </div>
      )}
      {r.data?.items.map((a) => (
        <article className="saas-panel" key={a.id}>
          <span className="saas-badge">{a.read ? "Lido" : "Não lido"}</span>
          <h3>{a.title}</h3>
          <p>
            {a.delivery === "uncertain"
              ? "Telegram: não foi possível confirmar a entrega; revisão administrativa necessária."
              : a.delivery === "failed"
                ? "Telegram: aviso não enviado. O anúncio pode ter expirado ou o canal recusado a mensagem."
                : a.delivery === "sent"
                  ? "Telegram: envio confirmado pelo canal."
                  : a.delivery === "pending" || a.delivery === "sending"
                    ? "Telegram: envio pendente."
                    : "Aviso disponível neste painel."}
          </p>
          <p>
            {a.event === "price_drop" ? "Queda observada" : "Novo observado"} ·{" "}
            {when(a.createdAt)}
          </p>
          <a href={`?view=results&listing=${encodeURIComponent(a.listingId)}`}>
            Ver anúncio e critérios
          </a>
        </article>
      ))}
      <div className="saas-pagination">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Anterior
        </button>
        <span>Página {page}</span>
        <button
          disabled={!r.data || page * 25 >= r.data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </button>
      </div>
    </section>
  );
}
export function PurchasesPanel() {
  const [page, setPage] = useState(1),
    r = useResource<{ items: Purchase[]; total: number }>(
      `purchases?page=${page}&limit=25`,
    );
  return (
    <section>
      <h2>Compras e vendas</h2>
      <p>Registros que você informou, separados de estimativas com anúncios.</p>
      {r.loading && <p role="status">Carregando…</p>}
      {r.error && (
        <p role="alert" className="saas-error">
          {r.error}
        </p>
      )}
      {r.data?.items.length === 0 && (
        <div className="saas-empty">
          <h3>Nenhuma compra registrada</h3>
          <p>Abra um anúncio, entre em Detalhes e use Registrar decisão.</p>
        </div>
      )}
      {r.data?.items.map((p) => (
        <article className="saas-panel" key={p.id}>
          <h3>{p.title}</h3>
          <p>
            Compra registrada: {money(p.paid)} · {when(p.boughtAt)}
          </p>
          <p>
            Venda registrada:{" "}
            {p.soldFor === null ? "Ainda não vendida" : money(p.soldFor)}
          </p>
          <p>Resultado realizado: {money(purchaseOutcome(p).net)}</p>
          <a href={`?view=results&listing=${encodeURIComponent(p.listingId)}`}>
            Registrar venda ou consultar anúncio
          </a>
        </article>
      ))}
      <div className="saas-pagination">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Anterior
        </button>
        <span>Página {page}</span>
        <button
          disabled={!r.data || page * 25 >= r.data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </button>
      </div>
    </section>
  );
}
export function AdminPanel() {
  const r = useResource<{
      diagnostics: unknown;
      quality: QualitySummary;
      contract: unknown;
      plans: {
        id: string;
        name: string;
        max_active: number;
        min_interval: number;
        daily_triggers: number;
        telegram: number;
      }[];
      worker: unknown;
    }>("admin/status"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section>
      <h2>Administração</h2>
      <p>Dados técnicos ficam aqui, nunca no fluxo básico do cliente.</p>
      <div className="saas-note">
        Credenciais e habilitação de coleta são definidas no ambiente protegido
        do servidor. Validar abaixo consulta somente metadata da fonte, sem
        executar uma coleta de anúncios.
      </div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await request("admin/provider/check", {});
            r.refresh();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Validar configuração, sem coleta
      </button>
      {(error || r.error) && (
        <p role="alert" className="saas-error">
          {error || r.error}
        </p>
      )}
      {r.data && (
        <>
          <h3>Qualidade das buscas desta conta</h3>
          <p>{r.data.quality.note}</p>
          <div className="saas-deal-stages">
            {[
              ["Execuções", r.data.quality.runs],
              ["Recebidos", r.data.quality.received],
              ["Produto correto", r.data.quality.matched],
              ["No orçamento", r.data.quality.withinBudget],
              ["Margem desejada", r.data.quality.qualified],
            ].map(([label, value]) => (
              <div className="saas-panel" key={String(label)}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p>
            Duplicações observadas: {r.data.quality.duplicates}. Execuções com
            falha: {r.data.quality.failed}. Aproveitamento observado:{" "}
            {r.data.quality.usableShare === null
              ? "ainda sem amostra"
              : r.data.quality.usableShare + "%"}
            .
          </p>
          {r.data.quality.reasons.map((row) => (
            <p key={row.reason}>
              {row.reason}: {row.count}
            </p>
          ))}
          <h3>Planos administrados</h3>
          {r.data.plans.map((p) => (
            <form
              key={p.id}
              className="saas-panel"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                try {
                  await request("admin/plans", {
                    id: p.id,
                    name: String(f.get("name")),
                    maxActive: Number(f.get("max")),
                    minInterval: Number(f.get("interval")),
                    dailyTriggers: Number(f.get("daily")),
                    telegram: f.has("telegram"),
                  });
                  r.refresh();
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="saas-field">
                <span>Nome</span>
                <input name="name" defaultValue={p.name} />
              </label>
              <div className="saas-grid-two">
                {[
                  ["max", "Buscas ativas", p.max_active],
                  ["interval", "Intervalo mínimo (s)", p.min_interval],
                  ["daily", "Cota diária", p.daily_triggers],
                ].map(([name, label, value]) => (
                  <label className="saas-field" key={name}>
                    <span>{label}</span>
                    <input
                      type="number"
                      name={String(name)}
                      defaultValue={value}
                      min={name === "interval" ? 60 : 0}
                    />
                  </label>
                ))}
              </div>
              <label className="saas-check">
                <input
                  type="checkbox"
                  name="telegram"
                  defaultChecked={!!p.telegram}
                />
                Permitir Telegram
              </label>
              <button disabled={busy}>Salvar limites</button>
            </form>
          ))}
          <details>
            <summary>Contrato validado</summary>
            <pre>{JSON.stringify(r.data.contract, null, 2)}</pre>
          </details>
          <details>
            <summary>Serviço e diagnóstico</summary>
            <pre>
              {JSON.stringify(
                { worker: r.data.worker, diagnostics: r.data.diagnostics },
                null,
                2,
              )}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}
