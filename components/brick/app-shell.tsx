"use client";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  Boxes,
  LayoutDashboard,
  LogOut,
  Plus,
  Radar,
  Receipt,
  UserRound,
  Users,
} from "lucide-react";
import { api, useApi } from "./api";
import { FEATURES } from "./brand";
import { Logo } from "./logo";
import { Account, initials } from "./account";
import { AdminUsers } from "./admin-users";
import { Dashboard } from "./dashboard";
import { Inventory } from "./inventory";
import { ItemDetailDrawer } from "./item-detail";
import { ItemForm } from "./item-form";
import { RadarSoon } from "./radar-soon";
import { Sales } from "./sales";
import { ToastProvider, useToast } from "./ui";
import type { ItemDetail, Me, Preferences } from "./types";

// The original radar UI, loaded only when the feature is switched on.
const LegacyRadar = lazy(() =>
  import("../radar-app").then((m) => ({ default: m.RadarApp })),
);

const VIEWS = [
  { id: "painel", label: "Painel", icon: LayoutDashboard },
  { id: "estoque", label: "Estoque", icon: Boxes },
  { id: "vendas", label: "Vendas", icon: Receipt },
  { id: "radar", label: "Radar", icon: Radar, soon: !FEATURES.radar },
  { id: "conta", label: "Conta", icon: UserRound },
  { id: "usuarios", label: "Usuários", icon: Users, adminOnly: true },
] as const;
type View = (typeof VIEWS)[number]["id"];

function useUrlState() {
  const [params, setParams] = useState(() => new URLSearchParams());
  useEffect(() => {
    const sync = () => setParams(new URLSearchParams(location.search));
    sync();
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);
  const navigate = useCallback(
    (values: Record<string, string | null>, replace = false) => {
      const next = new URLSearchParams(location.search);
      for (const [k, v] of Object.entries(values)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const url = `${location.pathname}${next.size ? `?${next}` : ""}`;
      if (replace) history.replaceState(null, "", url);
      else history.pushState(null, "", url);
      setParams(next);
    },
    [],
  );
  return [params, navigate] as const;
}

function Shell({ me }: { me: Me }) {
  const toast = useToast();
  const [params, navigate] = useUrlState();
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<{ item: ItemDetail | null } | null>(
    null,
  );
  const prefs = useApi<Preferences>("brick/preferences");
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const allowed = VIEWS.filter((v) => !("adminOnly" in v) || me.admin);
  const view = (
    allowed.some((v) => v.id === params.get("v")) ? params.get("v") : "painel"
  ) as View;
  const openItem = useCallback(
    (id: string) => navigate({ item: id }),
    [navigate],
  );
  const goTo = useCallback(
    (v: string, extra: Record<string, string> = {}) => {
      navigate({ v, status: null, item: null, ...extra });
      scrollTo({ top: 0, behavior: "smooth" });
    },
    [navigate],
  );
  useEffect(() => {
    if (params.get("boasvindas")) {
      toast({
        tone: "success",
        title: `Conta criada! Bem-vindo(a)${me.user.name ? `, ${me.user.name.split(" ")[0]}` : ""}.`,
        description: "Comece cadastrando o primeiro produto do seu estoque.",
      });
      navigate({ boasvindas: null }, true);
    }
  }, [params, me.user.name, navigate, toast]);
  const logout = async () => {
    await api("auth/logout", { body: {} }).catch(() => undefined);
    location.href = "/";
  };
  const newItem = () => setEditor({ item: null });
  const staleAfterDays = prefs.data?.staleAfterDays ?? 30;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Logo />
        <button className="btn btn-primary sidebar-cta" onClick={newItem}>
          <Plus size={17} /> Novo produto
        </button>
        <nav className="nav" aria-label="Navegação principal">
          {allowed.map(({ id, label, icon: Icon, ...rest }) => (
            <button
              key={id}
              className="nav-item"
              aria-current={view === id ? "page" : undefined}
              onClick={() => goTo(id)}
            >
              <Icon size={19} />
              {label}
              {"soon" in rest && rest.soon ? (
                <span className="badge soon">Em breve</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="avatar">
              {initials(me.user.name, me.user.email)}
            </span>
            <div style={{ flex: 1 }}>
              <strong>{me.user.name ?? "Minha conta"}</strong>
              <small>{me.user.email}</small>
            </div>
            <button
              className="btn btn-ghost btn-icon"
              onClick={logout}
              aria-label="Sair"
              title="Sair"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <Logo />
          <button
            className="avatar"
            style={{ border: 0, cursor: "pointer" }}
            onClick={() => goTo("conta")}
            aria-label="Conta"
          >
            {initials(me.user.name, me.user.email)}
          </button>
        </header>
        <main className="main" id="conteudo" key={view}>
          {view === "painel" && (
            <Dashboard
              me={me}
              version={version}
              onOpenItem={openItem}
              onNewItem={newItem}
              goTo={goTo}
            />
          )}
          {view === "estoque" && (
            <Inventory
              key={params.get("status") ?? "open"}
              version={version}
              initialStatus={params.get("status")}
              staleAfterDays={staleAfterDays}
              onOpenItem={openItem}
              onNewItem={newItem}
            />
          )}
          {view === "vendas" && (
            <Sales version={version} onOpenItem={openItem} />
          )}
          {view === "radar" &&
            (FEATURES.radar ? (
              <Suspense fallback={null}>
                <LegacyRadar />
              </Suspense>
            ) : (
              <RadarSoon />
            ))}
          {view === "conta" && (
            <Account
              me={me}
              onLogout={logout}
              onSaved={() => {
                bump();
                prefs.refresh();
              }}
              onManageUsers={me.admin ? () => goTo("usuarios") : undefined}
            />
          )}
          {view === "usuarios" && me.admin && <AdminUsers me={me} />}
        </main>
      </div>
      <nav className="tabbar" aria-label="Navegação">
        {VIEWS.filter((v) => v.id !== "conta")
          .slice(0, 2)
          .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => goTo(id)}
            >
              <Icon size={21} />
              {label}
            </button>
          ))}
        <button onClick={newItem} aria-label="Novo produto">
          <span className="fab">
            <Plus size={24} />
          </span>
        </button>
        {VIEWS.filter((v) => v.id === "vendas" || v.id === "radar").map(
          ({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => goTo(id)}
            >
              <Icon size={21} />
              {label}
            </button>
          ),
        )}
      </nav>
      <ItemDetailDrawer
        id={params.get("item")}
        onClose={() => navigate({ item: null })}
        onChanged={bump}
        onEdit={(item) => setEditor({ item })}
      />
      <ItemForm
        open={!!editor}
        item={editor?.item ?? null}
        onClose={() => setEditor(null)}
        onSaved={(item, created) => {
          setEditor(null);
          bump();
          toast({
            tone: "success",
            title: created ? "Produto cadastrado!" : "Alterações salvas",
            description: created ? "Ele já aparece no seu estoque." : undefined,
          });
          if (created) openItem(item.id);
          else navigate({ item: item.id }, true);
        }}
      />
    </div>
  );
}

export function BrickApp() {
  const me = useApi<Me>("auth/me");
  if (!me.data)
    return (
      <div className="page-loader" aria-busy="true">
        <span className="logo-mark">
          <Radar size={28} />
        </span>
        {me.error && <p className="muted">{me.error}</p>}
      </div>
    );
  return (
    <ToastProvider>
      <Shell me={me.data} />
    </ToastProvider>
  );
}
