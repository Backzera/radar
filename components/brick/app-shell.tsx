"use client";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Boxes,
  CornerDownLeft,
  LayoutDashboard,
  LogOut,
  Plus,
  Radar,
  Receipt,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { api, useApi } from "./api";
import { BRAND, FEATURES } from "./brand";
import { Logo, LogoMark } from "./logo";
import { Account, initials } from "./account";
import { AdminUsers } from "./admin-users";
import { AdminAudit, type AuditTab } from "./admin-audit";
import { Dashboard } from "./dashboard";
import { Inventory } from "./inventory";
import { ItemDetailDrawer } from "./item-detail";
import { ItemForm } from "./item-form";
import { RadarSoon } from "./radar-soon";
import { Sales } from "./sales";
import { ToastProvider, useToast } from "./ui";
import type { ItemDetail, Me, Preferences } from "./types";
import { withBase } from "./base";

// The radar UI, loaded only when the feature is switched on.
const LegacyRadar = lazy(() =>
  import("../radar-app").then((m) => ({ default: m.RadarApp })),
);

const VIEWS = [
  { id: "painel", label: "Painel", icon: LayoutDashboard, key: "1" },
  { id: "estoque", label: "Estoque", icon: Boxes, key: "2" },
  { id: "vendas", label: "Vendas", icon: Receipt, key: "3" },
  { id: "radar", label: "Radar", icon: Radar, key: "4", soon: !FEATURES.radar },
  { id: "conta", label: "Conta", icon: UserRound, key: "5" },
  { id: "usuarios", label: "Usuários", icon: Users, adminOnly: true },
  { id: "auditoria", label: "Auditoria", icon: ShieldCheck, adminOnly: true },
] as const;
type View = (typeof VIEWS)[number]["id"];
type ViewDef = (typeof VIEWS)[number];

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

const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

type Command = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: LucideIcon;
  keys?: string;
  run: () => void;
};

/** ⌘K palette: navigation and the main actions, searchable. */
function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? commands.filter((c) =>
          `${c.label} ${c.hint ?? ""} ${c.group}`.toLowerCase().includes(q),
        )
      : commands;
  }, [commands, query]);
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setQuery("");
      setCursor(0);
      input.current?.focus();
    });
  }, [open]);
  useEffect(() => {
    queueMicrotask(() => setCursor(0));
  }, [query]);
  if (!open) return null;
  const pick = (c: Command) => {
    onClose();
    c.run();
  };
  const groups = [...new Set(results.map((c) => c.group))];
  return (
    <div
      className="cmdk-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Comandos">
        <div className="cmdk-input">
          <Search size={18} />
          <input
            ref={input}
            value={query}
            placeholder="Ir para… ou fazer algo"
            aria-label="Buscar comando"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(results.length - 1, c + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              }
              if (e.key === "Enter" && results[cursor]) pick(results[cursor]);
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="cmdk-list" role="listbox">
          {results.length === 0 && (
            <div className="cmdk-empty">Nada encontrado para “{query}”.</div>
          )}
          {groups.map((group) => (
            <div key={group}>
              <div className="cmdk-group">{group}</div>
              {results
                .filter((c) => c.group === group)
                .map((c) => {
                  const index = results.indexOf(c);
                  const Icon = c.icon;
                  return (
                    <button
                      key={c.id}
                      className="cmdk-item"
                      role="option"
                      aria-selected={index === cursor}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => pick(c)}
                    >
                      <Icon size={17} />
                      <span>{c.label}</span>
                      {c.hint && (
                        <small className="muted" style={{ fontSize: 12 }}>
                          {c.hint}
                        </small>
                      )}
                      {c.keys && <span className="kbd">{c.keys}</span>}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
        <div className="cmdk-foot">
          <span>
            <span className="kbd">↑↓</span> navegar
          </span>
          <span>
            <span className="kbd">
              <CornerDownLeft size={10} />
            </span>{" "}
            abrir
          </span>
        </div>
      </div>
    </div>
  );
}

function Shell({ me }: { me: Me }) {
  const toast = useToast();
  const [params, navigate] = useUrlState();
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<{ item: ItemDetail | null } | null>(
    null,
  );
  const [palette, setPalette] = useState(false);
  const prefs = useApi<Preferences>("brick/preferences");
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const allowed = useMemo(
    () => VIEWS.filter((v) => !("adminOnly" in v) || me.admin),
    [me.admin],
  );
  const view = (
    allowed.some((v) => v.id === params.get("v")) ? params.get("v") : "painel"
  ) as View;
  const current = VIEWS.find((v) => v.id === view) as ViewDef;
  const openItem = useCallback(
    (id: string) => navigate({ item: id }),
    [navigate],
  );
  const goTo = useCallback(
    (v: string, extra: Record<string, string> = {}) => {
      navigate({ v, status: null, item: null, aba: null, usuario: null, ...extra });
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
  const logout = useCallback(async () => {
    await api("auth/logout", { body: {} }).catch(() => undefined);
    location.href = withBase("/");
  }, []);
  const newItem = useCallback(() => setEditor({ item: null }), []);
  const staleAfterDays = prefs.data?.staleAfterDays ?? 30;
  const mod = isMac() ? "⌘" : "Ctrl";

  // Keyboard: ⌘K palette, ⌘N new product, ⌘1-5 views.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (k === "n" && !e.shiftKey) {
        e.preventDefault();
        newItem();
      } else if (/^[1-5]$/.test(k)) {
        const target = allowed.find((v) => "key" in v && v.key === k);
        if (target) {
          e.preventDefault();
          goTo(target.id);
        }
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [allowed, goTo, newItem]);

  const commands: Command[] = [
    {
      id: "new",
      label: "Novo produto",
      hint: "Cadastrar uma compra",
      group: "Ações",
      icon: Plus,
      keys: `${mod} N`,
      run: newItem,
    },
    ...allowed.map((v) => ({
      id: v.id,
      label: v.label,
      group: "adminOnly" in v ? "Administração" : "Ir para",
      icon: v.icon,
      keys: "key" in v ? `${mod} ${v.key}` : undefined,
      run: () => goTo(v.id),
    })),
    {
      id: "logout",
      label: "Sair da conta",
      group: "Conta",
      icon: LogOut,
      run: () => void logout(),
    },
  ];

  const navButton = ({ id, label, icon: Icon, ...rest }: ViewDef) => (
    <button
      key={id}
      className="nav-item"
      aria-current={view === id ? "page" : undefined}
      onClick={() => goTo(id)}
    >
      <Icon size={18} />
      {label}
      {"soon" in rest && rest.soon ? (
        <span className="badge soon">Em breve</span>
      ) : "key" in rest ? (
        <span className="nav-key">
          {mod} {rest.key}
        </span>
      ) : null}
    </button>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <Logo />
        <button className="btn btn-primary sidebar-cta" onClick={newItem}>
          <Plus size={17} /> Novo produto
          <span className="kbd">{mod} N</span>
        </button>
        <nav className="nav" aria-label="Navegação principal">
          <div className="nav-label">Operação</div>
          {allowed.filter((v) => !("adminOnly" in v)).map(navButton)}
          {me.admin && (
            <>
              <div className="nav-label" style={{ marginTop: 10 }}>
                Administração
              </div>
              {allowed.filter((v) => "adminOnly" in v).map(navButton)}
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-status">
            <span className="pulse-dot" /> Sincronizado
          </div>
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
      <div className="main-col">
        <header className="topbar">
          <div className="crumb">
            <span className="hide-mobile crumb-root">
              <span className="logo-mark" style={{ width: 26, height: 26, borderRadius: 8 }}>
                <LogoMark size={15} />
              </span>
            </span>
            <span className="hide-mobile crumb-root">{BRAND.name}</span>
            <span className="sep hide-mobile crumb-root">/</span>
            <span className="logo-mark" style={{ width: 30, height: 30, borderRadius: 9 }} data-mobile-only>
              <LogoMark size={17} />
            </span>
            <strong>{current.label}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="cmd-btn"
              onClick={() => setPalette(true)}
              aria-label="Abrir comandos"
            >
              <Search size={15} />
              <span className="cmd-text">Ir para ou fazer algo…</span>
              <span className="kbd">{mod} K</span>
            </button>
            <button
              className="avatar"
              onClick={() => goTo("conta")}
              aria-label="Conta"
              title={me.user.email ?? "Conta"}
            >
              {initials(me.user.name, me.user.email)}
            </button>
          </div>
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
            <Sales version={version} onOpenItem={openItem} initialTab={params.get("aba")} />
          )}
          {view === "radar" &&
            (FEATURES.radar ? (
              <>
                <div className="view-head fade-up">
                  <div>
                    <h1>Radar de oportunidades</h1>
                    <p>Anúncios recentes dentro dos seus critérios, com a conta do lucro feita.</p>
                  </div>
                </div>
                <Suspense
                  fallback={
                    <div className="dash" aria-busy="true">
                      <div className="skeleton span-12" style={{ height: 48 }} />
                      <div className="skeleton span-8" style={{ height: 160 }} />
                      <div className="skeleton span-4" style={{ height: 160 }} />
                    </div>
                  }
                >
                  <LegacyRadar embedded />
                </Suspense>
              </>
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
              onOpenAudit={me.admin ? () => goTo("auditoria") : undefined}
            />
          )}
          {view === "usuarios" && me.admin && (
            <AdminUsers
              me={me}
              onOpenAudit={(id) => goTo("auditoria", { aba: "atividade", usuario: id })}
            />
          )}
          {view === "auditoria" && me.admin && (
            <AdminAudit
              tab={(["geral", "produtos", "atividade"].includes(params.get("aba") ?? "") ? params.get("aba") : "geral") as AuditTab}
              user={params.get("usuario") ?? ""}
              onChange={({ tab, user }) => navigate({ aba: tab, usuario: user || null })}
            />
          )}
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
      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />
      <ItemDetailDrawer
        id={params.get("item")}
        onClose={() => navigate({ item: null })}
        onChanged={bump}
        onEdit={(item) => setEditor({ item })}
        onOpen={(id) => navigate({ item: id }, true)}
      />
      <ItemForm
        open={!!editor}
        item={editor?.item ?? null}
        onClose={() => setEditor(null)}
        onSaved={(item, created) => {
          setEditor(null);
          bump();
          const units = item.group?.units ?? 1;
          toast({
            tone: "success",
            title: !created ? "Alterações salvas" : units > 1 ? `${units} unidades cadastradas!` : "Produto cadastrado!",
            description: created
              ? units > 1
                ? "Aparecem juntas no estoque; cada uma com seu valor."
                : "Ele já aparece no seu estoque."
              : undefined,
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
          <LogoMark size={30} />
        </span>
        <span className="loader-text">{me.error ? "Falha ao carregar" : "Carregando painel"}</span>
        {me.error && <p className="muted">{me.error}</p>}
      </div>
    );
  return (
    <ToastProvider>
      <Shell me={me.data} />
    </ToastProvider>
  );
}
