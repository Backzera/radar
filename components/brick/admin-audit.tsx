"use client";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  ChevronDown,
  Download,
  History,
  LogIn,
  Package,
  Receipt,
  Search,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  PERIOD_LABELS,
  PERIODS,
  STATUS_LABELS,
  STATUSES,
  addDays,
  formatCents,
  todayIn,
  type Period,
} from "@/core/brick";
import { ACTIVITY_GROUPS, groupOf, type ActivityGroup } from "@/core/activity";
import type { adminActivity, adminItems, adminOverview } from "@/server/admin-audit";
import { useApi } from "./api";
import { initials } from "./account";
import { BRAND, PLANS } from "./brand";
import { ProfitColumns } from "./charts";
import { PeriodPicker } from "./dashboard";
import { CountUp, Drawer, EmptyState, Photo, StatusBadge } from "./ui";
import { withBase } from "./base";

type Overview = Awaited<ReturnType<typeof adminOverview>>;
type ItemsPage = Awaited<ReturnType<typeof adminItems>>;
type AdminItem = ItemsPage["items"][number];
type ActivityPage = Awaited<ReturnType<typeof adminActivity>>;
type AuditEvent = ActivityPage["events"][number];
type Person = { id: string; name: string; email: string };
export type AuditTab = "geral" | "produtos" | "atividade";

const TABS: [AuditTab, string, LucideIcon][] = [
  ["geral", "Visão geral", Wallet],
  ["produtos", "Produtos", Boxes],
  ["atividade", "Atividade", Activity],
];
const GROUP_ICONS: Record<ActivityGroup, LucideIcon> = {
  items: Package,
  sales: Receipt,
  access: LogIn,
  admin: ShieldCheck,
  exports: Download,
};
const pctText = (v: number | null) =>
  v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const dateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Nunca";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const planName = (id: string | null) => PLANS.find((p) => p.id === id)?.name ?? "Sem plano";

function useDebounced(value: string, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function PersonCell({ person, fallback = "Conta excluída" }: { person: { name: string | null; email: string | null } | null; fallback?: string }) {
  if (!person) return <span className="muted">{fallback}</span>;
  return (
    <div className="product-cell">
      <span className="avatar" style={{ width: 30, height: 30, fontSize: 11.5 }}>
        {initials(person.name, person.email)}
      </span>
      <span style={{ minWidth: 0 }}>
        <strong style={{ display: "block", fontWeight: 600 }}>{person.name ?? "Conta excluída"}</strong>
        <small className="muted">{person.email}</small>
      </span>
    </div>
  );
}

function PersonSelect({ value, onChange, people }: { value: string; onChange: (id: string) => void; people: Person[] }) {
  return (
    <select className="select" aria-label="Usuário" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Todos os usuários</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} · {p.email}
        </option>
      ))}
    </select>
  );
}

function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  if (total <= limit) return null;
  const last = Math.ceil(total / limit);
  return (
    <div className="pager">
      <span className="muted">
        {(page - 1) * limit + 1}–{Math.min(page * limit, total)} de {total}
      </span>
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </button>
      <button className="btn btn-sm" disabled={page >= last} onClick={() => onPage(page + 1)}>
        Próxima
      </button>
    </div>
  );
}

function Tiles({ tiles, offset = 0 }: { tiles: [string, React.ReactNode, React.ReactNode?][]; offset?: number }) {
  return (
    <div className="summary-strip" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
      {tiles.map(([label, value, foot], i) => (
        <div key={label} className="card kpi fade-up" style={{ "--i": i + offset } as React.CSSProperties}>
          <div className="kpi-label">{label}</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>
            {value}
          </div>
          {foot ? <div className="kpi-foot">{foot}</div> : null}
        </div>
      ))}
    </div>
  );
}

function OverviewTab({ onPick }: { onPick: (userId: string, tab: AuditTab) => void }) {
  const [period, setPeriod] = useState<Period>("month");
  const { data, error } = useApi<Overview>(`admin/overview?period=${period}`);
  if (error) return <p>{error}</p>;
  const s = data?.sales;
  const p = data?.platform;
  const mrr = p ? p.plans.essencial * PLANS[0].priceCents + p.plans.pro * PLANS[1].priceCents : 0;
  return (
    <>
      <div className="audit-toolbar fade-up">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {!data || !s || !p ? (
        <div className="summary-strip">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 96 }} />
          ))}
        </div>
      ) : (
        <>
          <Tiles
            tiles={[
              ["Faturamento dos usuários", <CountUp key="r" value={s.revenueCents} />, plural(s.count, "venda", "vendas")],
              [
                "Lucro líquido",
                <span key="p" className={s.profitCents < 0 ? "profit-neg" : ""}>
                  <CountUp value={s.profitCents} />
                </span>,
                "depois de custos e taxas",
              ],
              ["Margem média", pctText(s.marginPct), `ROI ${pctText(s.roiPct)}`],
              ["Ticket médio", s.count ? formatCents(Math.round(s.revenueCents / s.count)) : "—", s.avgDaysToSell === null ? "" : `vende em ${s.avgDaysToSell} dias`],
              ["Em estoque", formatCents(data.stock.investedCents), plural(data.stock.count, "produto parado", "produtos parados")],
            ]}
          />
          <Tiles
            offset={5}
            tiles={[
              ["Produtos cadastrados", String(p.itemsRegistered), `${p.itemsTotal} no total`],
              ["Usuários ativos", `${p.activeUsers} de ${p.users}`, p.newUsers ? `+${p.newUsers} novos no período` : "nenhum novo no período"],
              ["Bloqueados", String(p.blockedUsers), "sem acesso no momento"],
              ["Planos (estimado/mês)", formatCents(mrr), `Essencial ${p.plans.essencial} · Pro ${p.plans.pro} · sem plano ${p.plans.none}`],
            ]}
          />
          <div className="dash" style={{ marginBottom: 16 }}>
            <section className="card span-8 fade-up" style={{ "--i": 9 } as React.CSSProperties}>
              <div className="card-head">
                <div>
                  <h3>Lucro de todos os usuários por mês</h3>
                  <p>Últimos 12 meses · pelo mês da venda</p>
                </div>
              </div>
              <ProfitColumns months={data.months} />
            </section>
            <section className="card span-4 fade-up" style={{ "--i": 10 } as React.CSSProperties}>
              <div className="card-head">
                <div>
                  <h3>O que mais dá lucro</h3>
                  <p>{PERIOD_LABELS[period]} · por categoria</p>
                </div>
              </div>
              {data.categories.length ? (
                <ul className="audit-rank">
                  {data.categories.slice(0, 6).map((c) => (
                    <li key={c.category}>
                      <span>{CATEGORY_LABELS[c.category]}</span>
                      <small className="muted">{plural(c.count, "venda", "vendas")}</small>
                      <strong className={c.profitCents < 0 ? "profit-neg" : "profit-pos"}>
                        {formatCents(c.profitCents, { sign: true })}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ fontSize: 13.5 }}>
                  Nenhuma venda no período.
                </p>
              )}
            </section>
          </div>
          <section className="card fade-up" style={{ "--i": 11 } as React.CSSProperties}>
            <div className="card-head">
              <div>
                <h3>Por usuário</h3>
                <p>{PERIOD_LABELS[period]} · vendas pela data da venda, estoque de agora</p>
              </div>
            </div>
            {!data.users.length ? (
              <EmptyState icon={Users} title="Nenhum usuário ainda" text="Quando alguém criar a conta, os números aparecem aqui." />
            ) : (
              <div className="table-wrap">
                <table className="table users-table">
                  <thead>
                    <tr>
                      <th>Usuário</th>
                      <th>Plano</th>
                      <th className="num-cell">Produtos</th>
                      <th className="num-cell">Estoque</th>
                      <th className="num-cell">Vendas</th>
                      <th className="num-cell">Faturamento</th>
                      <th className="num-cell">Lucro</th>
                      <th className="num-cell">Margem</th>
                      <th>Última atividade</th>
                      <th className="num-cell">Ver</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.id} style={{ cursor: "default" }}>
                        <td>
                          <PersonCell person={u} />
                          {u.status === "blocked" && (
                            <span className="badge blocked" style={{ height: 20, marginTop: 4 }}>
                              Bloqueado
                            </span>
                          )}
                        </td>
                        <td className="muted">{planName(u.plan)}</td>
                        <td className="num-cell">
                          {u.items}
                          {u.registeredInPeriod ? <small className="muted"> · +{u.registeredInPeriod}</small> : null}
                        </td>
                        <td className="num-cell">
                          {formatCents(u.stockInvestedCents)}
                          <small className="muted" style={{ display: "block" }}>
                            {plural(u.stockCount, "item", "itens")}
                          </small>
                        </td>
                        <td className="num-cell">{u.soldCount}</td>
                        <td className="num-cell">{formatCents(u.revenueCents)}</td>
                        <td className={`num-cell ${u.profitCents < 0 ? "profit-neg" : u.profitCents > 0 ? "profit-pos" : ""}`}>
                          <strong>{formatCents(u.profitCents, { sign: true })}</strong>
                        </td>
                        <td className="num-cell">{pctText(u.marginPct)}</td>
                        <td className="muted">
                          {dateTime(u.lastActivityAt ?? u.lastLoginAt)}
                          {u.actionsInPeriod ? (
                            <small style={{ display: "block" }}>{plural(u.actionsInPeriod, "ação", "ações")} no período</small>
                          ) : null}
                        </td>
                        <td className="num-cell">
                          <div className="row-actions">
                            <button className="btn btn-ghost btn-icon" title="Produtos" aria-label={`Produtos de ${u.name}`} onClick={() => onPick(u.id, "produtos")}>
                              <Boxes size={16} />
                            </button>
                            <button className="btn btn-ghost btn-icon" title="Atividade" aria-label={`Atividade de ${u.name}`} onClick={() => onPick(u.id, "atividade")}>
                              <Activity size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function ItemsTab({
  user,
  onUser,
  people,
  onOpen,
}: {
  user: string;
  onUser: (id: string) => void;
  people: Person[];
  onOpen: (item: AdminItem) => void;
}) {
  const [text, setText] = useState("");
  const q = useDebounced(text);
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState<"" | Period>("");
  const [page, setPage] = useState(1);
  const filters = {
    ...(user ? { user } : {}),
    ...(status ? { status } : {}),
    ...(q ? { q } : {}),
    ...(period ? { period } : {}),
  };
  const { data, error } = useApi<ItemsPage>(
    `admin/items?${new URLSearchParams({ ...filters, page: String(page), limit: "50" })}`,
  );
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  return (
    <section className="card fade-up">
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <label className="search">
          <Search size={17} />
          <span className="sr-only">Buscar produto ou usuário</span>
          <input className="input" placeholder="Produto, marca, usuário ou e-mail…" value={text} onChange={(e) => reset(setText)(e.target.value)} />
        </label>
        <PersonSelect value={user} onChange={reset(onUser)} people={people} />
        <select className="select" aria-label="Etapa" value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
          <option value="">Todas as etapas</option>
          <option value="open">Sem vender</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Cadastrados" value={period} onChange={(e) => reset(setPeriod)(e.target.value as "" | Period)}>
          <option value="">Cadastrados: sempre</option>
          {PERIODS.filter((p) => p !== "all").map((p) => (
            <option key={p} value={p}>
              Cadastrados: {PERIOD_LABELS[p].toLowerCase()}
            </option>
          ))}
        </select>
        <a className="btn" href={withBase(`/api/v1/admin/items/export.csv?${new URLSearchParams(filters)}`)}>
          <Download size={16} /> Planilha
        </a>
      </div>
      {data && (
        <p className="audit-totals">
          <strong>{data.total}</strong> {data.total === 1 ? "produto" : "produtos"} · investido <strong>{formatCents(data.totals.investedCents)}</strong> · {plural(data.totals.soldCount, "vendido", "vendidos")} por{" "}
          <strong>{formatCents(data.totals.revenueCents)}</strong> · lucro{" "}
          <strong className={data.totals.profitCents < 0 ? "profit-neg" : "profit-pos"}>{formatCents(data.totals.profitCents, { sign: true })}</strong>
        </p>
      )}
      {error ? (
        <p>{error}</p>
      ) : !data ? (
        <div style={{ display: "grid", gap: 10 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 52 }} />
          ))}
        </div>
      ) : !data.items.length ? (
        <EmptyState icon={Boxes} title="Nenhum produto encontrado" text="Mude os filtros ou espere os usuários cadastrarem produtos." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Usuário</th>
                  <th>Cadastro</th>
                  <th>Etapa</th>
                  <th className="num-cell">Investido</th>
                  <th className="num-cell">Venda</th>
                  <th className="num-cell">Lucro</th>
                  <th className="num-cell">Dias</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id} onClick={() => onOpen(i)}>
                    <td>
                      <div className="product-cell">
                        <Photo id={i.coverPhotoId} category={i.category} alt="" admin />
                        <button
                          className="btn-ghost"
                          style={{ border: 0, background: "none", padding: 0, textAlign: "left", cursor: "pointer", fontWeight: 560, color: "inherit" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(i);
                          }}
                        >
                          {i.name}
                          <small className="muted" style={{ display: "block", fontWeight: 400 }}>
                            {CATEGORY_LABELS[i.category]}
                            {i.brand ? ` · ${i.brand}` : ""}
                          </small>
                        </button>
                      </div>
                    </td>
                    <td>
                      <PersonCell person={i.owner} />
                    </td>
                    <td className="muted">{dateTime(i.createdAt)}</td>
                    <td>
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="num-cell">{formatCents(i.figures.investedCents)}</td>
                    <td className="num-cell">{i.salePriceCents === null ? <span className="muted">—</span> : formatCents(i.salePriceCents)}</td>
                    <td className={`num-cell ${i.figures.profitCents === null ? "" : i.figures.profitCents >= 0 ? "profit-pos" : "profit-neg"}`}>
                      {i.figures.profitCents === null ? <span className="muted">—</span> : <strong>{formatCents(i.figures.profitCents, { sign: true })}</strong>}
                    </td>
                    <td className="num-cell muted">{i.figures.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}

const DETAIL_SKIP = new Set(["backfill", "filters"]);
function EventDetails({ event }: { event: AuditEvent }) {
  const d = event.details as Record<string, unknown> | null;
  const changes = Array.isArray(d?.changes) ? (d!.changes as { label: string; from: string; to: string }[]) : null;
  const facts = d
    ? Object.entries(d).filter(([k, v]) => !DETAIL_SKIP.has(k) && k !== "changes" && v !== null && typeof v !== "object")
    : [];
  return (
    <div className="audit-details">
      {changes && (
        <table className="table">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Antes</th>
              <th>Depois</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.label} style={{ cursor: "default" }}>
                <td>{c.label}</td>
                <td className="muted">{c.from}</td>
                <td>{c.to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {facts.length > 0 && (
        <dl>
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{/Cents$/.test(k) && typeof v === "number" ? formatCents(v) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <dl>
        <div>
          <dt>Quando</dt>
          <dd>{new Date(event.createdAt).toLocaleString("pt-BR")}</dd>
        </div>
        <div>
          <dt>IP</dt>
          <dd>{event.ip ?? "—"}</dd>
        </div>
        {event.userAgent && (
          <div>
            <dt>Navegador</dt>
            <dd>{event.userAgent}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function EventList({ events, showUser = true }: { events: AuditEvent[]; showUser?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ol className="audit-list">
      {events.map((e) => {
        const group = groupOf(e.action);
        const Icon = e.warning ? AlertTriangle : group ? GROUP_ICONS[group] : History;
        const byOther = e.actor && e.actor.id !== e.user?.id;
        const backfill = !!(e.details as { backfill?: unknown } | null)?.backfill;
        return (
          <li key={e.id} className={`audit-row ${e.warning ? "warning" : ""}`}>
            <span className={`audit-icon ${group ?? ""}`}>
              <Icon size={16} />
            </span>
            <div className="audit-main">
              <p>{e.summary}</p>
              <div className="audit-meta">
                <span className="badge" style={{ height: 20 }}>
                  {e.label}
                </span>
                {showUser && <span>{e.user ? (e.user.name ?? "Conta excluída") : "Sem conta"}</span>}
                {byOther && <span>por {e.actor!.name ?? e.actor!.email}</span>}
                {e.ip && <span className="mono">{e.ip}</span>}
                {backfill && <span>histórico importado</span>}
              </div>
              {open === e.id && <EventDetails event={e} />}
            </div>
            <div className="audit-side">
              <time dateTime={e.createdAt}>{dateTime(e.createdAt)}</time>
              <button
                className="btn btn-ghost btn-icon"
                aria-expanded={open === e.id}
                aria-label="Detalhes"
                onClick={() => setOpen(open === e.id ? null : e.id)}
              >
                <ChevronDown size={16} style={{ transform: open === e.id ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const RANGES: [string, string][] = [
  ["", "Tudo"],
  ["0", "Hoje"],
  ["6", "7 dias"],
  ["29", "30 dias"],
];
function ActivityTab({ user, onUser, people }: { user: string; onUser: (id: string) => void; people: Person[] }) {
  const [text, setText] = useState("");
  const q = useDebounced(text);
  const [group, setGroup] = useState<"" | ActivityGroup>("");
  const [range, setRange] = useState("");
  const [page, setPage] = useState(1);
  const today = todayIn();
  const filters = {
    ...(user ? { user } : {}),
    ...(group ? { group } : {}),
    ...(q ? { q } : {}),
    ...(range ? { from: addDays(today, -Number(range)), to: today } : {}),
  };
  const { data, error } = useApi<ActivityPage>(
    `admin/activity?${new URLSearchParams({ ...filters, page: String(page), limit: "50" })}`,
  );
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  return (
    <section className="card fade-up">
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <label className="search">
          <Search size={17} />
          <span className="sr-only">Buscar na atividade</span>
          <input className="input" placeholder="Produto, valor, usuário ou IP…" value={text} onChange={(e) => reset(setText)(e.target.value)} />
        </label>
        <PersonSelect value={user} onChange={reset(onUser)} people={people} />
        <div className="segmented" role="group" aria-label="Período">
          {RANGES.map(([value, label]) => (
            <button key={label} aria-pressed={range === value} onClick={() => reset(setRange)(value)}>
              {label}
            </button>
          ))}
        </div>
        <a className="btn" href={withBase(`/api/v1/admin/activity/export.csv?${new URLSearchParams(filters)}`)}>
          <Download size={16} /> Planilha
        </a>
      </div>
      <div className="chips" role="group" aria-label="Tipo">
        <button className="chip" aria-pressed={group === ""} onClick={() => reset(setGroup)("")}>
          Tudo
        </button>
        {(Object.keys(ACTIVITY_GROUPS) as ActivityGroup[]).map((g) => (
          <button key={g} className="chip" aria-pressed={group === g} onClick={() => reset(setGroup)(g)}>
            {ACTIVITY_GROUPS[g].label}
          </button>
        ))}
        {data && <span className="count muted" style={{ alignSelf: "center", marginLeft: "auto" }}>{plural(data.total, "registro", "registros")}</span>}
      </div>
      {error ? (
        <p>{error}</p>
      ) : !data ? (
        <div style={{ display: "grid", gap: 10 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 58 }} />
          ))}
        </div>
      ) : !data.events.length ? (
        <EmptyState icon={History} title="Nada registrado com esses filtros" text="Tudo o que os usuários fazem no sistema aparece aqui: cadastros, edições, vendas, acessos e exportações." />
      ) : (
        <>
          <EventList events={data.events} />
          <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}

function ItemTrail({ item, onClose }: { item: AdminItem | null; onClose: () => void }) {
  const { data } = useApi<ActivityPage>(item ? `admin/activity?${new URLSearchParams({ item: item.id, limit: "200" })}` : null);
  if (!item) return null;
  const figures: [string, string][] = [
    ["Valor pago", formatCents(item.purchasePriceCents)],
    ["Custos extras", formatCents(item.costsCents)],
    ["Total investido", formatCents(item.figures.investedCents)],
    ["Preço pedido", formatCents(item.askingPriceCents)],
    ["Venda", formatCents(item.salePriceCents)],
    ["Lucro", item.figures.profitCents === null ? "—" : formatCents(item.figures.profitCents, { sign: true })],
  ];
  return (
    <Drawer open onClose={onClose} wide title={item.name} subtitle={`${CATEGORY_LABELS[item.category]} · cadastrado em ${dateTime(item.createdAt)}`}>
      <div className="audit-head">
        <Photo id={item.coverPhotoId} category={item.category} alt="" admin className="audit-photo" />
        <div className="audit-head-info">
          <PersonCell person={item.owner} />
          <StatusBadge status={item.status} />
        </div>
      </div>
      <dl className="audit-figures">
        {figures.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <h3 style={{ fontSize: 15, fontWeight: 640, margin: "20px 0 10px" }}>Histórico do produto</h3>
      {!data ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : !data.events.length ? (
        <p className="muted">Nenhum registro deste produto.</p>
      ) : (
        <EventList events={data.events} showUser={false} />
      )}
    </Drawer>
  );
}

export function AdminAudit({
  tab,
  user,
  onChange,
}: {
  tab: AuditTab;
  user: string;
  onChange: (next: { tab: AuditTab; user: string }) => void;
}) {
  const people = useApi<{ users: Person[] }>("admin/users?limit=100");
  const [item, setItem] = useState<AdminItem | null>(null);
  const list = people.data?.users ?? [];
  return (
    <>
      <div className="view-head fade-up">
        <div>
          <h1>Auditoria</h1>
          <p>
            Tudo o que acontece no {BRAND.name}: resultado de cada usuário, produtos cadastrados e o registro de cada ação. Só administradores veem esta tela.
          </p>
        </div>
      </div>
      <div className="segmented audit-tabs fade-up" role="group" aria-label="Seção">
        {TABS.map(([id, label, Icon]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => onChange({ tab: id, user })}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === "geral" && <OverviewTab onPick={(id, next) => onChange({ tab: next, user: id })} />}
      {tab === "produtos" && (
        <ItemsTab user={user} onUser={(id) => onChange({ tab, user: id })} people={list} onOpen={setItem} />
      )}
      {tab === "atividade" && <ActivityTab user={user} onUser={(id) => onChange({ tab, user: id })} people={list} />}
      <ItemTrail item={item} onClose={() => setItem(null)} />
    </>
  );
}
