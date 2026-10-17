"use client";
/* eslint-disable @next/next/no-img-element -- Imagens de anúncios carregadas diretamente, sem proxy ou custo externo adicional. */
import { useEffect, useRef, useState } from "react";
import { Search, ArrowUpRight, Bookmark, Package } from "lucide-react";
import type { Bootstrap } from "../../server/bootstrap";
import type { getFeed } from "../../server/feed";
import {
  customerDecision,
  customerReason,
  negotiationMessage,
} from "../../core/customer-copy";
import { relativePublication } from "../../core/selection";
import type { Opportunity } from "../../core/types";
import {
  request,
  useResource,
  errorText,
  money,
  when,
  safeListingUrl,
} from "./client";
type Feed = Awaited<ReturnType<typeof getFeed>>;
export const resultLabels = {
  all: "Para você",
  budget: "No meu orçamento",
  qualified: "Margem desejada",
  baseline: "Busca inicial",
  new: "Encontrados depois da ativação",
  price_drop: "Quedas de preço",
  saved: "Salvos",
  dismissed: "Descartei",
  review: "Para revisar",
  history: "Histórico completo",
};
function ListingImage({ o }: { o: Opportunity }) {
  const [failed, setFailed] = useState(false),
    url = o.listing.images[0];
  return (
    <div className="saas-listing-image">
      {url && !failed && /^https:\/\//.test(url) ? (
        <img
          src={url}
          alt={o.listing.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <Package aria-label="Sem foto disponível" size={38} />
      )}
    </div>
  );
}
export function ResultsFeed({
  bootstrap: b,
  params,
  onParams,
  version,
  onCreate,
}: {
  bootstrap: Bootstrap;
  params: URLSearchParams;
  onParams: (p: Record<string, string>) => void;
  version: number;
  onCreate: () => void;
}) {
  const query = new URLSearchParams();
  for (const key of ["q", "sort", "filter", "page", "monitorId"])
    if (params.has(key)) query.set(key, params.get(key)!);
  if (params.get("view") === "saved") query.set("filter", "saved");
  query.set("limit", "25");
  const resource = useResource<Feed>(`results?${query}`),
    [search, setSearch] = useState(params.get("q") ?? ""),
    [error, setError] = useState(""),
    [dismiss, setDismiss] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState("");
  const termFromUrl = params.get("q") ?? "";
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) setSearch(termFromUrl);
    });
    return () => {
      mounted = false;
    };
  }, [termFromUrl]);
  const refresh = resource.refresh;
  useEffect(() => {
    if (version) refresh();
  }, [version, refresh]);
  async function preference(id: string, body: unknown) {
    setBusy(id);
    setError("");
    try {
      await request(`listing-preferences/${encodeURIComponent(id)}`, body);
      setDismiss(null);
      setReason("");
      refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  const filter = params.get("filter") ?? "all",
    detailId = params.get("listing");
  return (
    <section>
      <div className="saas-section-head">
        <div>
          <h2>
            {filter === "saved" ? "Anúncios salvos" : "Oportunidades para você"}
          </h2>
          <p>
            Critérios claros para decidir. Confira sempre o anúncio e o
            vendedor.
          </p>
        </div>
        <button className="saas-primary" onClick={onCreate}>
          Novo radar
        </button>
      </div>
      <div className="saas-toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onParams({ q: search, page: "1" });
          }}
        >
          <label className="saas-search-input">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="Pesquisar no histórico completo"
              placeholder="Pesquisar no histórico"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={150}
            />
          </label>
          <button type="submit">Pesquisar</button>
        </form>
        <label>
          <span className="saas-visually-hidden">Ordenar resultados</span>
          <select
            value={params.get("sort") ?? "relevance"}
            onChange={(e) => onParams({ sort: e.target.value, page: "1" })}
          >
            <option value="relevance">Relevância</option>
            <option value="price">Menor preço</option>
            <option value="recent">Publicados recentemente</option>
          </select>
        </label>
        <label>
          <span className="saas-visually-hidden">Filtrar por busca</span>
          <select
            value={params.get("monitorId") ?? ""}
            onChange={(e) => onParams({ monitorId: e.target.value, page: "1" })}
          >
            <option value="">Todas as buscas</option>
            {b.searches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="saas-filter-tabs" aria-label="Tipo de resultado">
        {Object.entries(resultLabels)
          .filter(
            ([k]) =>
              ![
                "saved",
                "history",
                "review",
                "dismissed",
                "baseline",
                "new",
                "budget",
              ].includes(k),
          )
          .map(([key, label]) => (
            <button
              key={key}
              aria-pressed={filter === key}
              onClick={() => onParams({ filter: key, page: "1" })}
            >
              {label}
            </button>
          ))}
      </div>
      <details className="saas-history-link">
        <summary>Consultar histórico e itens fora dos critérios</summary>
        <p>
          Estes itens não são oportunidades recomendadas. Nenhum registro foi
          apagado.
        </p>
        <div className="saas-actions">
          {["review", "history", "dismissed", "baseline", "new"].map((k) => (
            <button
              key={k}
              aria-pressed={filter === k}
              onClick={() => onParams({ filter: k, page: "1" })}
            >
              {resultLabels[k as keyof typeof resultLabels]}
            </button>
          ))}
        </div>
      </details>
      {["history", "review", "dismissed"].includes(filter) && (
        <p className="saas-note">
          {resultLabels[filter as keyof typeof resultLabels]}: pode incluir
          itens antigos, incompatíveis ou indisponíveis. Não são novas
          recomendações.
        </p>
      )}
      {(error || resource.error) && (
        <div role="alert" className="saas-error">
          <p>{error || resource.error}</p>
          <button onClick={refresh}>Tentar novamente</button>
        </div>
      )}
      {resource.loading && <p role="status">Atualizando seus resultados…</p>}
      {resource.data && (
        <>
          <p className="saas-muted" aria-live="polite">
            {resource.data.total} resultados neste filtro · Avaliados em{" "}
            {when(resource.data.assessedAt)}
          </p>
          {!resource.data.items.length && (
            <div className="saas-empty">
              <Search size={32} />
              <h3>
                {!b.searches.length
                  ? "O que você quer encontrar?"
                  : "Ainda não encontramos uma boa combinação"}
              </h3>
              <p>
                {!b.searches.length
                  ? "Ative seu primeiro radar. Começamos a procurar assim que você terminar."
                  : !b.service.ready || !b.service.collectionEnabled
                    ? "Suas buscas estão salvas, mas a fonte ainda precisa ser habilitada pela administração."
                    : b.searches.some((m) => m.operational.lastError)
                      ? "Uma busca não concluiu. Veja o motivo e a orientação em Minhas buscas; não é necessário repetir o pedido várias vezes."
                      : b.searches.some(
                            (m) => m.operational.status === "buscando",
                          )
                        ? "Há uma busca em andamento. Os resultados aparecerão quando ela concluir."
                        : "Confira a última execução em Minhas buscas. Um anúncio pode não corresponder ao produto, orçamento ou condição. Isso é diferente de uma falha da fonte."}
              </p>
              <button
                onClick={
                  !b.searches.length
                    ? onCreate
                    : () => onParams({ view: "searches" })
                }
              >
                {!b.searches.length
                  ? "Criar primeiro radar"
                  : "Ver meus radares"}
              </button>
              {filter !== "all" && (
                <button
                  onClick={() => onParams({ filter: "all", q: "", page: "1" })}
                >
                  Voltar às oportunidades
                </button>
              )}
            </div>
          )}
          <div className="saas-results-grid">
            {resource.data.items.map((o) => {
              const l = o.listing,
                a = o.analysis,
                url = safeListingUrl(l.originalUrl ?? l.url),
                m = b.searches.find((m) => m.id === a.monitorId),
                resale = m?.intent !== "personal";
              return (
                <article className="saas-listing-card" key={l.id}>
                  <ListingImage o={o} />
                  <div className="saas-card-content">
                    <div className="saas-card-tags">
                      <span
                        className={`saas-badge ${a.event !== "baseline" ? "new" : ""}`}
                      >
                        {a.event === "baseline"
                          ? "Busca inicial"
                          : a.event === "price_drop"
                            ? "Queda de preço"
                            : "Novo no radar"}
                      </span>
                      <span
                        className={`saas-badge ${a.budgetEligible ? "positive" : ""}`}
                      >
                        {a.eligible
                          ? "Margem desejada"
                          : a.budgetEligible
                            ? "Dentro do orçamento"
                            : "Fora da seleção"}
                      </span>
                    </div>
                    <h3>{l.title}</h3>
                    <strong className="saas-price">{money(l.price)}</strong>
                    <p className="saas-muted">
                      {l.city || "Localização não informada"} ·{" "}
                      {l.availability === "active"
                        ? "Disponível segundo a fonte"
                        : l.availability === "unknown"
                          ? "Disponibilidade não confirmada"
                          : "Verificar disponibilidade"}
                    </p>
                    <p className="saas-muted">
                      {l.publishedAt && l.publicationStatus === "valid"
                        ? l.publicationSource === "badge"
                          ? "Recém-publicado segundo o Facebook · sem data exata"
                          : relativePublication(l.publishedAt)
                        : `Data não confirmada · confira no anúncio · visto ${when(l.firstSeenAt)}`}
                    </p>
                    <p>
                      {a.budgetEligible
                        ? `Atende ao orçamento da busca ${a.monitorName ?? "selecionada"}.`
                        : customerReason(
                            a.blocked[0] ??
                              "Confira os detalhes antes de decidir.",
                          )}
                    </p>
                    {resale && a.monitorId && a.pricing.quickSale !== null && (
                      <div className="saas-estimate">
                        <span>
                          Lucro líquido estimado{" "}
                          <strong>{money(a.netProfit)}</strong>
                        </span>
                        <small>
                          {a.pricing.source === "manual"
                            ? "Hipótese informada por você, não preço comprovado."
                            : "Estimativa com as premissas da busca; não é garantia de venda."}
                        </small>
                      </div>
                    )}
                    <div className="saas-actions">
                      {url ? (
                        <a
                          className="saas-button saas-primary"
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Ver anúncio <ArrowUpRight size={16} />
                        </a>
                      ) : (
                        <span>Link original indisponível</span>
                      )}
                      <button onClick={() => onParams({ listing: l.id })}>
                        Detalhes
                      </button>
                      <button
                        aria-label={
                          o.saved
                            ? `Remover ${l.title} dos salvos`
                            : `Salvar ${l.title}`
                        }
                        aria-pressed={o.saved}
                        onClick={() =>
                          void preference(l.id, { saved: !o.saved })
                        }
                        disabled={busy === l.id}
                      >
                        <Bookmark size={18} />
                      </button>
                      <button
                        onClick={() =>
                          o.dismissed
                            ? void preference(l.id, { dismissed: false })
                            : setDismiss(l.id)
                        }
                      >
                        {o.dismissed ? "Restaurar" : "Descartar"}
                      </button>
                    </div>
                    {dismiss === l.id && (
                      <form
                        className="saas-dismiss"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void preference(l.id, { dismissed: true, reason });
                        }}
                      >
                        <label>
                          Motivo
                          <input
                            value={reason}
                            maxLength={200}
                            onChange={(e) => setReason(e.target.value)}
                            required
                            placeholder="Ex.: produto diferente"
                          />
                        </label>
                        <button disabled={busy === l.id}>
                          Confirmar descarte
                        </button>
                        <button type="button" onClick={() => setDismiss(null)}>
                          Cancelar
                        </button>
                      </form>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="saas-pagination">
            <button
              disabled={resource.data.page <= 1 || resource.loading}
              onClick={() =>
                onParams({ page: String(resource.data!.page - 1) })
              }
            >
              Anterior
            </button>
            <span>
              Página {resource.data.page} de{" "}
              {Math.max(
                1,
                Math.ceil(resource.data.total / resource.data.limit),
              )}
            </span>
            <button
              disabled={!resource.data.hasNext || resource.loading}
              onClick={() =>
                onParams({ page: String(resource.data!.page + 1) })
              }
            >
              Próxima
            </button>
          </div>
        </>
      )}
      {detailId && (
        <ListingDialog
          key={detailId}
          id={detailId}
          searches={b.searches}
          availabilityEnabled={b.service.availabilityEnabled}
          onClose={() => onParams({ listing: "" })}
          onChanged={refresh}
        />
      )}
    </section>
  );
}
type Detail = Opportunity & {
  deal: { stage: string; version: number; note: string } | null;
  availabilityCheck?: {
    status: string;
    result: string;
    checked_at: string | null;
    message: string | null;
  } | null;
  comparablesTotal: number;
  snapshots: {
    price: number | null;
    availability: string;
    observed_at: string;
  }[];
  page: number;
  limit: number;
};
export function ListingDialog({
  id,
  searches,
  onClose,
  onChanged,
  availabilityEnabled = false,
}: {
  id: string;
  searches: Bootstrap["searches"];
  onClose: () => void;
  onChanged: () => void;
  availabilityEnabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [action, setAction] = useState("bought"),
    [amount, setAmount] = useState(""),
    [costs, setCosts] = useState(""),
    [note, setNote] = useState(""),
    [offer, setOffer] = useState(""),
    [copyText, setCopyText] = useState(""),
    [confirmCheck, setConfirmCheck] = useState(false);
  const resource = useResource<Detail>(
    `listings/${encodeURIComponent(id)}?page=${page}&limit=25`,
  );
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => {
      d?.close();
    };
  }, []);
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setNotice(message);
      onChanged();
      resource.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function feedback(e: React.FormEvent) {
    e.preventDefault();
    await act(
      () =>
        request("feedback", {
          listingId: id,
          type: action,
          note,
          ...(action === "bought"
            ? { paid: Number(amount), costs: Number(costs || 0) }
            : action === "sold"
              ? { soldFor: Number(amount), additionalCosts: Number(costs || 0) }
              : {}),
        }),
      "Registro salvo no seu histórico.",
    );
  }
  const o = resource.data,
    resale =
      searches.find((m) => m.id === o?.analysis.monitorId)?.intent !==
      "personal",
    explanation = o ? customerDecision(o) : null;
  const stageLabels: Record<string, string> = {
    interested: "Interessado",
    negotiating: "Em negociação",
    bought: "Comprado",
    for_sale: "À venda",
    sold: "Vendido",
    passed: "Não vou comprar",
  };
  async function stage(value: string) {
    await act(
      () =>
        request("deals/" + encodeURIComponent(id), {
          stage: value,
          expectedVersion: o?.deal?.version,
          note: o?.deal?.note ?? "",
        }),
      "Etapa atualizada em Meus negócios.",
    );
  }
  return (
    <dialog
      className="saas saas-dialog"
      ref={dialog}
      aria-labelledby="listing-dialog-title"
      onCancel={onClose}
    >
      <div className="saas-section-head">
        <div>
          <p className="saas-eyebrow">ANÁLISE DA COMPRA</p>
          <h2 id="listing-dialog-title">Vale a pena conferir?</h2>
        </div>
        <button onClick={onClose} aria-label="Fechar detalhes">
          Fechar
        </button>
      </div>
      {resource.loading && <p role="status">Carregando detalhes…</p>}
      {resource.error && (
        <p role="alert" className="saas-error">
          {resource.error}
        </p>
      )}
      {o && explanation && (
        <>
          <h3 className="saas-detail-title">{o.listing.title}</h3>
          <div className="saas-detail-price">
            <strong className="saas-price">{money(o.listing.price)}</strong>
            <span>{o.listing.city || "Cidade não informada"}</span>
          </div>
          <p className="saas-muted">
            {o.listing.publicationStatus === "valid" &&
            o.listing.publicationSource === "badge"
              ? "Recém-publicado segundo o Facebook · sem data exata"
              : o.listing.publishedAt &&
                  o.listing.publicationStatus === "valid"
                ? relativePublication(o.listing.publishedAt)
                : "Data não confirmada · confira no anúncio"}{" "}
            · {explanation.initial || "Encontrado pelo seu radar."}
          </p>
          <div className="saas-actions">
            {safeListingUrl(o.listing.originalUrl ?? o.listing.url) && (
              <a
                className="saas-button saas-primary"
                href={safeListingUrl(o.listing.originalUrl ?? o.listing.url)!}
                target="_blank"
                rel="noopener noreferrer"
              >
                Ver anúncio <ArrowUpRight size={16} />
              </a>
            )}
            {!o.deal && (
              <button disabled={busy} onClick={() => void stage("interested")}>
                Tenho interesse
              </button>
            )}
            {o.deal?.stage === "interested" && (
              <button disabled={busy} onClick={() => void stage("negotiating")}>
                Comecei a negociar
              </button>
            )}
            {o.deal && (
              <span className="saas-badge">{stageLabels[o.deal.stage]}</span>
            )}
          </div>
          {resale && (
            <section className="saas-calculation">
              <h3>Conta da revenda</h3>
              <dl className="saas-facts">
                <div>
                  <dt>Compra anunciada</dt>
                  <dd>{money(o.listing.price)}</dd>
                </div>
                <div>
                  <dt>Revenda considerada</dt>
                  <dd>{money(o.analysis.pricing.quickSale)}</dd>
                </div>
                <div>
                  <dt>Despesas estimadas</dt>
                  <dd>{money(o.analysis.totalCosts)}</dd>
                </div>
                <div>
                  <dt>Margem estimada</dt>
                  <dd>{money(o.analysis.netProfit)}</dd>
                </div>
              </dl>
              <p>{explanation.priceSource}</p>
              <p>
                <strong>Até quanto pagar:</strong>{" "}
                {money(
                  o.analysis.pricing.recommendedBuy == null
                    ? null
                    : Math.min(
                        o.analysis.pricing.recommendedBuy,
                        o.analysis.maxPurchasePrice ?? Infinity,
                      ),
                )}
                . Considere seu orçamento e confirme os custos antes de
                negociar.
              </p>
            </section>
          )}
          <section className="saas-decision">
            <h3>Por que apareceu</h3>
            {explanation.why.length ? (
              explanation.why.map((t, i) => <p key={i}>✓ {t}</p>)
            ) : (
              <p>
                Este anúncio está no histórico, mas não atende a um radar ativo
                neste momento.
              </p>
            )}
            <h3>Antes de comprar</h3>
            {explanation.caveats.slice(0, 5).map((t, i) => (
              <p key={i}>{t}</p>
            ))}
            <p>
              Confira o produto e o vendedor antes de pagar. A análise não é uma
              garantia de venda ou de segurança.
            </p>
          </section>
          <section className="saas-availability">
            <h3>O anúncio ainda está disponível?</h3>
            <p>
              {o.listing.availability === "active"
                ? "Disponível segundo a última resposta da fonte."
                : o.listing.availability === "unknown"
                  ? "A disponibilidade ainda não está confirmada."
                  : "A fonte indicou que este item não está disponível."}
              {o.availabilityCheck?.checked_at
                ? ` Consulta em ${when(o.availabilityCheck.checked_at)}.`
                : ""}
            </p>
            {o.availabilityCheck && (
              <p role="status">
                {["pending", "running"].includes(o.availabilityCheck.status)
                  ? "A conferência está na fila ou em andamento."
                  : o.availabilityCheck.message}
              </p>
            )}
            <div className="saas-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      request("listing-preferences/" + encodeURIComponent(id), {
                        dismissed: true,
                        reason: "O anúncio não abre para mim",
                      }),
                    "Removido da sua seleção. Isso não afirma que o anúncio foi vendido.",
                  )
                }
              >
                O anúncio não abre
              </button>
              {availabilityEnabled && (
                <button
                  disabled={
                    busy ||
                    ["pending", "running"].includes(
                      o.availabilityCheck?.status ?? "",
                    )
                  }
                  onClick={() => setConfirmCheck(true)}
                >
                  Conferir na fonte
                </button>
              )}
            </div>
            {confirmCheck && (
              <div className="saas-note">
                <p>
                  Esta conferência pode consumir uma pesquisa da sua cota e usa
                  a fonte configurada. Não é uma compra do produto.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const r = await request(
                        "availability/" + encodeURIComponent(id),
                        { confirmConsumption: true },
                      );
                      setConfirmCheck(false);
                      return r;
                    }, "Conferência solicitada. Consultas recentes são reaproveitadas.")
                  }
                >
                  Confirmar conferência
                </button>{" "}
                <button onClick={() => setConfirmCheck(false)}>Cancelar</button>
              </div>
            )}
          </section>
          <details className="saas-negotiation">
            <summary>Preparar uma mensagem para negociar</summary>
            <p>
              Revise a mensagem e envie você mesmo ao vendedor. Nenhum contato é
              feito automaticamente.
            </p>
            <label className="saas-field">
              <span>Minha oferta, opcional (R$)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
              />
            </label>
            <textarea
              aria-label="Mensagem para o vendedor"
              readOnly
              value={negotiationMessage(o, Number(offer))}
              rows={5}
            />
            <button
              onClick={() => {
                const text = negotiationMessage(o, Number(offer));
                void navigator.clipboard
                  ?.writeText(text)
                  .then(() => setCopyText("Mensagem copiada."))
                  .catch(() => setCopyText("Selecione o texto acima e copie."));
                if (!navigator.clipboard)
                  setCopyText("Selecione o texto acima e copie.");
              }}
            >
              Copiar mensagem
            </button>
            <span role="status">{copyText}</span>
          </details>
          <details>
            <summary>Descrição do vendedor</summary>
            <p className="saas-description">
              {o.listing.description || "Descrição não informada."}
            </p>
          </details>
          <details>
            <summary>Referências de preço e histórico</summary>
            <p>
              Preços de anúncios semelhantes, não vendas concluídas.{" "}
              {o.comparablesTotal} referências avaliadas.
            </p>
            {o.analysis.pricing.comparables
              .filter((c) => c.included)
              .map((c) => (
                <p key={c.id}>
                  {c.title}: {money(c.price)}
                </p>
              ))}
            {o.snapshots.map((s, i) => (
              <p key={i}>
                {when(s.observed_at)}: {money(s.price)}
              </p>
            ))}
            <div className="saas-actions">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </button>
              <button
                disabled={
                  page * 25 >= o.comparablesTotal && o.snapshots.length < 25
                }
                onClick={() => setPage((p) => p + 1)}
              >
                Mais referências
              </button>
            </div>
          </details>
          <details className="saas-advanced">
            <summary>Registrar compra, venda ou correção</summary>
            <form onSubmit={feedback}>
              <label className="saas-field">
                <span>O que aconteceu?</span>
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="bought">Comprei este item</option>
                  <option value="sold">Vendi o item comprado</option>
                  <option value="wrong_product">
                    O produto está diferente do que pedi
                  </option>
                  <option value="wrong_price">O preço está incorreto</option>
                  <option value="false_positive">
                    Não é uma boa oportunidade
                  </option>
                  <option value="passed">Decidi não comprar</option>
                </select>
              </label>
              {["bought", "sold"].includes(action) && (
                <div className="saas-grid-two">
                  <label className="saas-field">
                    <span>
                      {action === "bought" ? "Preço pago" : "Preço de venda"}{" "}
                      (R$)
                    </span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <label className="saas-field">
                    <span>
                      {action === "bought"
                        ? "Custos da compra"
                        : "Custos adicionais da venda"}{" "}
                      (R$)
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={costs}
                      onChange={(e) => setCosts(e.target.value)}
                    />
                  </label>
                </div>
              )}
              <label className="saas-field">
                <span>Observação</span>
                <textarea
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <button className="saas-primary" disabled={busy}>
                {busy ? "Salvando…" : "Salvar registro"}
              </button>
            </form>
          </details>
        </>
      )}
      {error && (
        <p role="alert" className="saas-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="saas-note">
          {notice}
        </p>
      )}
    </dialog>
  );
}
