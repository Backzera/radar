"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Radar,
  Search,
  Bookmark,
  Bell,
  User,
  SlidersHorizontal,
  ShoppingBag,
  RefreshCw,
} from "lucide-react";
import type { Bootstrap } from "../../server/bootstrap";
import type { Monitor } from "../../core/types";
import { isUnlimitedTriggers } from "../../core/limits";
import { useResource, request, errorText } from "./client";
import { SearchWizard, type Draft } from "./search-wizard";
import { SearchList } from "./search-list";
import { DealsPanel } from "./deals-panel";
import { ResultsFeed } from "./results-feed";
import { AccountPanel, AlertsPanel, AdminPanel } from "./account-panel";
import { BRAND } from "../brick/brand";
const navigation = [
  ["results", "Oportunidades", Search],
  ["searches", "Meus radares", Radar],
  ["saved", "Salvos", Bookmark],
  ["alerts", "Avisos", Bell],
  ["purchases", "Meus negócios", ShoppingBag],
  ["account", "Conta", User],
] as const;
/**
 * The radar. Standalone it renders its own sidebar; embedded in the Ágio
 * shell (embedded=true) the sections become a tab row so there is only one
 * sidebar on screen.
 */
export function RadarShell({ embedded = false }: { embedded?: boolean } = {}) {
  const b = useResource<Bootstrap>("bootstrap"),
    [params, setParams] = useState(() => new URLSearchParams()),
    [wizard, setWizard] = useState<{ monitor?: Monitor; draft?: Draft } | null>(
      null,
    ),
    [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false);
  const bootstrapRefresh = b.refresh,
    hasData = !!b.data;
  const refresh = useCallback(() => {
    bootstrapRefresh();
    setVersion((v) => v + 1);
  }, [bootstrapRefresh]);
  useEffect(() => {
    const sync = () => setParams(new URLSearchParams(window.location.search));
    queueMicrotask(sync);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    if (!hasData) return;
    const events = new EventSource("/api/v1/events");
    let previous = "",
      timer: ReturnType<typeof setTimeout> | undefined;
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.addEventListener("radar", (event) => {
      const data = (event as MessageEvent).data;
      if (previous && previous !== data) {
        clearTimeout(timer);
        timer = setTimeout(refresh, 400);
      }
      previous = data;
    });
    const poll = setInterval(refresh, 30000);
    return () => {
      events.close();
      clearInterval(poll);
      clearTimeout(timer);
    };
  }, [hasData, bootstrapRefresh, refresh]);
  const change = (values: Record<string, string>) => {
    const next = new URLSearchParams(window.location.search);
    Object.entries(values).forEach(([k, v]) =>
      v ? next.set(k, v) : next.delete(k),
    );
    window.history.pushState({}, "", `${window.location.pathname}?${next}`);
    setParams(next);
  };
  const create = async () => {
    setError("");
    try {
      const draft = await request<Draft | null>("draft");
      setWizard({ draft: draft ?? undefined });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const data = b.data,
    view = params.get("view") ?? "results";
  const go = (id: string) => {
    setWizard(null);
    if (id === "admin") change({ view: "admin" });
    else
      change({
        view: id,
        filter: id === "saved" ? "saved" : "all",
        page: "1",
        listing: "",
      });
  };
  const navButtons = (
    <>
      {navigation.map(([id, label, Icon]) => (
        <button
          key={id}
          aria-current={view === id ? "page" : undefined}
          onClick={() => go(id)}
        >
          <Icon size={18} />
          {label}
        </button>
      ))}
      {data?.session.admin && (
        <button
          aria-current={view === "admin" ? "page" : undefined}
          onClick={() => go("admin")}
        >
          <SlidersHorizontal size={18} />
          Administração
        </button>
      )}
    </>
  );
  return (
    <div className={`saas saas-app${embedded ? " saas-embedded" : ""}`}>
      {!embedded && (
        <a className="saas-skip" href="#radar-content">
          Ir para o conteúdo
        </a>
      )}
      {embedded ? (
        <nav className="radar-tabs" aria-label="Seções do radar">
          {navButtons}
          <span className="radar-tabs-side">
            <span className="saas-status-dot" data-connected={connected} />
            {connected ? "ao vivo" : "em espera"}
            <button
              className="btn btn-ghost btn-icon"
              onClick={refresh}
              disabled={b.loading}
              aria-label="Atualizar radar"
              title="Atualizar"
            >
              <RefreshCw size={15} />
            </button>
          </span>
        </nav>
      ) : (
        <aside className="saas-sidebar">
          <div className="saas-brand">
            <Radar size={29} />
            <span>
              {BRAND.name}
              <small>Radar de oportunidades</small>
            </span>
          </div>
          <nav aria-label="Navegação principal">{navButtons}</nav>
          <div className="saas-sidebar-foot">
            <span className="saas-status-dot" data-connected={connected} />
            {connected ? "Painel conectado" : "Conexão do painel em espera"}
            <small>A conexão não comprova que a fonte está coletando.</small>
          </div>
        </aside>
      )}
      <main id="radar-content" className="saas-main">
        <header className="saas-topbar">
          <span>{data?.account.plan.name ?? "Seu espaço de buscas"}</span>
          <button
            onClick={refresh}
            disabled={b.loading}
            aria-label="Atualizar painel"
          >
            <RefreshCw size={16} />
            <span>Atualizar</span>
          </button>
        </header>
        {!data && b.loading && (
          <div className="saas-empty" role="status">
            Verificando seu acesso…
          </div>
        )}
        {b.error && (
          <div className="saas-error" role="alert">
            <h2>Não foi possível acessar o painel</h2>
            <p>{b.error}</p>
            <button onClick={b.refresh}>Tentar novamente</button>
            <p>
              Seu acesso precisa ser confirmado. Entre pela página de acesso do
              serviço ou contate o responsável pela instalação.
            </p>
          </div>
        )}
        {error && (
          <p className="saas-error" role="alert">
            {error}
          </p>
        )}
        {data && (
          <>
            {data.account.status !== "active" && (
              <div className="saas-note">
                Acesso cancelado. Seu histórico permanece disponível; buscas e
                canais estão pausados.
              </div>
            )}
            {wizard ? (
              <SearchWizard
                key={wizard.monitor?.id ?? "new"}
                bootstrap={data}
                monitor={wizard.monitor}
                draft={wizard.draft}
                onClose={() => setWizard(null)}
                onSaved={(monitorId) => {
                  setWizard(null);
                  change({
                    view: "results",
                    monitorId,
                    filter: "all",
                    page: "1",
                    q: "",
                    listing: "",
                  });
                  refresh();
                }}
              />
            ) : view === "searches" ? (
              <SearchList
                bootstrap={data}
                onEdit={(monitor) => setWizard({ monitor })}
                onCreate={() => void create()}
                onRefresh={refresh}
              />
            ) : view === "account" ? (
              <AccountPanel bootstrap={data} onRefresh={refresh} />
            ) : view === "alerts" ? (
              <AlertsPanel />
            ) : view === "purchases" ? (
              <DealsPanel
                searches={data.searches}
                availabilityEnabled={data.service.availabilityEnabled}
              />
            ) : view === "admin" && data.session.admin ? (
              <AdminPanel />
            ) : (
              <>
                <section className="saas-dashboard-head">
                  <div>
                    <p className="saas-eyebrow">
                      Radar · seleção para você
                    </p>
                    <h1>Encontre sua próxima compra.</h1>
                    <p>
                      Produto certo, no seu orçamento. Somente publicações de
                      até 7 dias.
                    </p>
                  </div>
                  <div className="saas-service-card">
                    <strong>
                      {
                        data.searches.filter((m) => m.active && !m.archived)
                          .length
                      }{" "}
                      radar
                      {data.searches.filter((m) => m.active && !m.archived)
                        .length === 1
                        ? " ativo"
                        : "es ativos"}
                    </strong>
                    <p>
                      {isUnlimitedTriggers(data.account.plan.dailyTriggers)
                        ? "Buscas ilimitadas"
                        : `${data.account.usedToday} de ${data.account.plan.dailyTriggers} pesquisas usadas hoje`}
                    </p>
                    <small>
                      {!data.service.ready || !data.service.collectionEnabled
                        ? "Aguardando configuração do serviço"
                        : data.service.quotaPaused
                          ? "Cota de hoje atingida"
                          : data.service.workerHealthy
                            ? "Acompanhamento ativo"
                            : "Pronto para buscar quando você quiser"}
                    </small>
                  </div>
                </section>
                {data.searches
                  .filter(
                    (m) =>
                      m.active &&
                      !m.archived &&
                      (!params.get("monitorId") ||
                        params.get("monitorId") === m.id),
                  )
                  .map((m) =>
                    m.operational.status === "buscando" ? (
                      <div
                        key={m.id}
                        className="saas-progress-note"
                        role="status"
                      >
                        <span className="saas-live-pulse" />
                        <div>
                          <strong>Procurando {m.product || m.query}…</strong>
                          <p>
                            {m.operational.message} Você pode sair desta tela.
                          </p>
                        </div>
                      </div>
                    ) : m.operational.lastError ? (
                      <div key={m.id} className="saas-note" role="status">
                        <strong>{m.name}: a pesquisa precisa de atenção</strong>
                        <p>{m.operational.lastError.message}</p>
                        <button onClick={() => change({ view: "searches" })}>
                          Ver orientação
                        </button>
                      </div>
                    ) : null,
                  )}
                <ResultsFeed
                  key={params.get("q") ?? ""}
                  bootstrap={data}
                  params={params}
                  onParams={change}
                  version={version}
                  onCreate={() => void create()}
                />
              </>
            )}
          </>
        )}
        <footer className="saas-footer">
          Preços anunciados não são vendas comprovadas. Verifique produto,
          disponibilidade e vendedor antes de pagar.
        </footer>
      </main>
    </div>
  );
}
