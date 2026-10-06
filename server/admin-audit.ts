/** Owner's control panel: everyone's results, every product and the full activity trail. */
import { z } from "zod";
import {
  CATEGORY_LABELS,
  CHANNEL_LABELS,
  PERIODS,
  STATUSES,
  STATUS_LABELS,
  addDays,
  isValidDate,
  itemFigures,
  periodRange,
  summarize,
  todayIn,
  type Category,
  type Channel,
  type Condition,
  type Status,
} from "../core/brick";
import { ACTION_LABELS, ACTIVITY_GROUPS, WARNING_ACTIONS, type ActivityAction } from "../core/activity";
import { actorOf, recordActivity } from "./activity";
import { csvMoney, csvResponse, photoResponse, type MediaStore } from "./inventory";
import { json } from "./respond";
import { HttpError, type Principal } from "./security";
import { all, type Database } from "./store";

// São Paulo has no daylight saving since 2019: its days start at 03:00 UTC.
const dayStart = (date: string) => `${date}T03:00:00.000Z`;
const spDate = (iso: string) => todayIn(new Date(iso));
const spDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }).replace(",", "");

interface ItemRow {
  id: string;
  user_id: string;
  name: string;
  category: Category;
  brand: string | null;
  model: string | null;
  condition: Condition;
  status: Status;
  purchase_price_cents: number;
  purchased_at: string;
  purchase_channel: Channel;
  asking_price_cents: number | null;
  sale_price_cents: number | null;
  sale_fees_cents: number;
  sold_at: string | null;
  sale_channel: Channel | null;
  created_at: string;
  updated_at: string;
  costs_cents: number;
  cover_photo_id: string | null;
  photo_count: number;
}
interface UserRow {
  user_id: string;
  name: string;
  email: string;
  created_at: string;
  last_login_at: string | null;
  status: string;
  plan: string | null;
}

async function itemRows(db: Database) {
  return all<ItemRow>(
    db,
    `SELECT i.id,i.user_id,i.name,i.category,i.brand,i.model,i.condition,i.status,i.purchase_price_cents,
       i.purchased_at,i.purchase_channel,i.asking_price_cents,i.sale_price_cents,i.sale_fees_cents,i.sold_at,
       i.sale_channel,i.created_at,i.updated_at,COALESCE(c.total,0) AS costs_cents,
       (SELECT p.id FROM inventory_photos p WHERE p.user_id=i.user_id AND p.item_id=i.id ORDER BY p.position,p.created_at LIMIT 1) AS cover_photo_id,
       (SELECT COUNT(*) FROM inventory_photos p WHERE p.user_id=i.user_id AND p.item_id=i.id) AS photo_count
     FROM inventory_items i
     LEFT JOIN (SELECT item_id,SUM(amount_cents) AS total FROM inventory_costs GROUP BY item_id) c ON c.item_id=i.id`,
  );
}
async function userRows(db: Database) {
  return all<UserRow>(
    db,
    `SELECT c.user_id,c.name,c.email,c.created_at,c.last_login_at,a.status,b.selected_plan AS plan
     FROM auth_credentials c JOIN accounts a ON a.user_id=c.user_id
     LEFT JOIN brick_preferences b ON b.user_id=c.user_id`,
  );
}

function present(row: ItemRow, today: string) {
  const money = {
    status: row.status,
    purchasePriceCents: row.purchase_price_cents,
    costsCents: Number(row.costs_cents),
    askingPriceCents: row.asking_price_cents,
    salePriceCents: row.sale_price_cents,
    saleFeesCents: row.sale_fees_cents,
    purchasedAt: row.purchased_at,
    soldAt: row.sold_at,
  };
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    category: row.category,
    brand: row.brand,
    model: row.model,
    condition: row.condition,
    purchaseChannel: row.purchase_channel,
    saleChannel: row.sale_channel,
    coverPhotoId: row.cover_photo_id,
    photoCount: Number(row.photo_count),
    createdAt: row.created_at,
    createdOn: spDate(row.created_at),
    updatedAt: row.updated_at,
    ...money,
    figures: itemFigures(money, today),
  };
}
type AdminItem = ReturnType<typeof present>;

const sum = (items: AdminItem[], pick: (i: AdminItem) => number | null) =>
  items.reduce((total, i) => total + (pick(i) ?? 0), 0);
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

export async function adminOverview(db: Database, period: string | null) {
  const p = z.enum(PERIODS).default("month").parse(period ?? undefined);
  const today = todayIn();
  const range = periodRange(p, today);
  const inRange = (date: string | null) => !!date && date >= range.start && date <= range.end;
  const [rows, users, activity] = await Promise.all([
    itemRows(db),
    userRows(db),
    all<{ user_id: string; last_at: string; in_period: number }>(
      db,
      `SELECT user_id,MAX(created_at) AS last_at,SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) AS in_period
       FROM activity_log WHERE user_id IS NOT NULL AND actor_id=user_id GROUP BY user_id`,
      dayStart(range.start),
    ),
  ]);
  const items = rows.map((r) => present(r, today));
  // Everyone's sales through the same math as each person's own dashboard.
  const combined = summarize(items, { period: p, today, goalCents: null, staleAfterDays: 30 });
  const activityBy = new Map(activity.map((a) => [a.user_id, a]));
  const perUser = users.map((u) => {
    const mine = items.filter((i) => i.userId === u.user_id);
    const sold = mine.filter((i) => i.figures.profitCents !== null && inRange(i.soldAt));
    const stock = mine.filter((i) => i.status !== "sold");
    const revenueCents = sum(sold, (i) => i.salePriceCents);
    const profitCents = sum(sold, (i) => i.figures.profitCents);
    const seen = activityBy.get(u.user_id);
    return {
      id: u.user_id,
      name: u.name,
      email: u.email,
      plan: u.plan,
      status: u.status === "active" ? ("active" as const) : ("blocked" as const),
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
      lastActivityAt: seen?.last_at ?? null,
      actionsInPeriod: Number(seen?.in_period ?? 0),
      items: mine.length,
      registeredInPeriod: mine.filter((i) => inRange(i.createdOn)).length,
      stockCount: stock.length,
      stockInvestedCents: sum(stock, (i) => i.figures.investedCents),
      soldCount: sold.length,
      revenueCents,
      profitCents,
      marginPct: pct(profitCents, revenueCents),
    };
  });
  perUser.sort((a, b) => b.revenueCents - a.revenueCents || b.items - a.items);
  const activeUsers = perUser.filter(
    (u) => u.actionsInPeriod > 0 || (u.lastLoginAt !== null && inRange(spDate(u.lastLoginAt))),
  ).length;
  const plans = { essencial: 0, pro: 0, none: 0 };
  for (const u of perUser)
    if (u.status === "active") plans[u.plan === "pro" ? "pro" : u.plan === "essencial" ? "essencial" : "none"]++;
  return {
    period: p,
    range: { start: range.start, end: range.end },
    sales: combined.sales,
    stock: combined.stock,
    months: combined.months,
    categories: combined.categories,
    platform: {
      users: perUser.length,
      activeUsers,
      newUsers: perUser.filter((u) => inRange(spDate(u.createdAt))).length,
      blockedUsers: perUser.filter((u) => u.status === "blocked").length,
      itemsTotal: items.length,
      itemsRegistered: items.filter((i) => inRange(i.createdOn)).length,
      plans,
    },
    users: perUser,
  };
}

const itemsQuery = z
  .object({
    user: z.string().max(120).default(""),
    status: z.enum(["", "open", ...STATUSES]).default(""),
    q: z.string().max(120).default(""),
    period: z.enum(["", ...PERIODS]).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

async function filteredItems(db: Database, query: z.infer<typeof itemsQuery>) {
  const today = todayIn();
  const [rows, users] = await Promise.all([itemRows(db), userRows(db)]);
  const owners = new Map(users.map((u) => [u.user_id, u]));
  const range = query.period ? periodRange(query.period, today) : null;
  const terms = fold(query.q).split(/\s+/).filter(Boolean);
  const items = rows
    .map((r) => present(r, today))
    .filter((i) => {
      const owner = owners.get(i.userId);
      return (
        (!query.user || i.userId === query.user) &&
        (!query.status ||
          (query.status === "open" ? i.status !== "sold" : i.status === query.status)) &&
        (!range || (i.createdOn >= range.start && i.createdOn <= range.end)) &&
        terms.every((term) =>
          fold(
            [i.name, i.brand, i.model, CATEGORY_LABELS[i.category], owner?.name, owner?.email]
              .filter(Boolean)
              .join(" "),
          ).includes(term),
        )
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const owner = (userId: string) => {
    const o = owners.get(userId);
    return o ? { id: o.user_id, name: o.name, email: o.email } : null;
  };
  return { items, owner };
}

export async function adminItems(db: Database, input: unknown) {
  const query = itemsQuery.parse(input);
  const { items, owner } = await filteredItems(db, query);
  const sold = items.filter((i) => i.figures.profitCents !== null);
  return {
    items: items
      .slice((query.page - 1) * query.limit, query.page * query.limit)
      .map((i) => ({ ...i, owner: owner(i.userId) })),
    total: items.length,
    page: query.page,
    limit: query.limit,
    totals: {
      investedCents: sum(items, (i) => i.figures.investedCents),
      soldCount: sold.length,
      revenueCents: sum(sold, (i) => i.salePriceCents),
      profitCents: sum(sold, (i) => i.figures.profitCents),
    },
  };
}

async function exportItems(db: Database, input: unknown) {
  const { items, owner } = await filteredItems(db, itemsQuery.parse({ ...(input as object), page: 1, limit: 100 }));
  const header = [
    "Usuário", "E-mail", "Cadastrado em", "Produto", "Categoria", "Marca", "Modelo", "Etapa",
    "Data da compra", "Comprado em", "Valor pago", "Custos extras", "Total investido", "Preço pedido",
    "Data da venda", "Vendido em", "Valor da venda", "Taxas da venda", "Lucro", "Margem %", "Dias em estoque",
  ];
  const rows = items.map((i) => {
    const o = owner(i.userId);
    return [
      o?.name ?? "", o?.email ?? "", spDateTime(i.createdAt), i.name, CATEGORY_LABELS[i.category],
      i.brand, i.model, STATUS_LABELS[i.status], i.purchasedAt, CHANNEL_LABELS[i.purchaseChannel],
      csvMoney(i.purchasePriceCents), csvMoney(i.costsCents), csvMoney(i.figures.investedCents),
      csvMoney(i.askingPriceCents), i.soldAt, i.saleChannel ? CHANNEL_LABELS[i.saleChannel] : "",
      csvMoney(i.salePriceCents), i.status === "sold" ? csvMoney(i.saleFeesCents) : "",
      csvMoney(i.figures.profitCents),
      i.figures.marginPct == null ? "" : String(i.figures.marginPct).replace(".", ","),
      i.figures.days,
    ];
  });
  return { response: csvResponse(header, rows, `produtos-usuarios-${todayIn()}.csv`), count: items.length };
}

const GROUPS = Object.keys(ACTIVITY_GROUPS) as (keyof typeof ACTIVITY_GROUPS)[];
const activityQuery = z
  .object({
    user: z.string().max(120).default(""),
    item: z.string().max(120).default(""),
    group: z.enum(["", ...GROUPS] as [string, ...string[]]).default(""),
    q: z.string().max(120).default(""),
    from: z.string().refine(isValidDate, "Data inválida.").optional(),
    to: z.string().refine(isValidDate, "Data inválida.").optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

function activityWhere(query: z.infer<typeof activityQuery>) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.user) {
    // Events about the person and events done by them (an admin's own actions).
    where.push("(l.user_id=? OR l.actor_id=?)");
    params.push(query.user, query.user);
  }
  if (query.item) {
    where.push("l.entity='item' AND l.entity_id=?");
    params.push(query.item);
  }
  if (query.group) {
    const actions = ACTIVITY_GROUPS[query.group as keyof typeof ACTIVITY_GROUPS].actions;
    where.push(`l.action IN (${actions.map(() => "?").join(",")})`);
    params.push(...actions);
  }
  const term = query.q.trim().toLowerCase();
  if (term) {
    where.push("(instr(lower(l.summary),?)>0 OR instr(lower(COALESCE(u.email,'')),?)>0 OR instr(lower(COALESCE(u.name,'')),?)>0 OR instr(COALESCE(l.ip,''),?)>0)");
    params.push(term, term, term, term);
  }
  if (query.from) {
    where.push("l.created_at>=?");
    params.push(dayStart(query.from));
  }
  if (query.to) {
    where.push("l.created_at<?");
    params.push(dayStart(addDays(query.to, 1)));
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}
const ACTIVITY_FROM = `FROM activity_log l
  LEFT JOIN auth_credentials u ON u.user_id=l.user_id
  LEFT JOIN auth_credentials a ON a.user_id=l.actor_id`;

interface EventRow {
  id: string;
  created_at: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  summary: string;
  details: string | null;
  ip: string | null;
  user_agent: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
}
async function eventRows(db: Database, query: z.infer<typeof activityQuery>, limit: number, offset: number) {
  const { sql, params } = activityWhere(query);
  return all<EventRow>(
    db,
    `SELECT l.id,l.created_at,l.action,l.entity,l.entity_id,l.summary,l.details,l.ip,l.user_agent,
       l.user_id,u.name AS user_name,u.email AS user_email,l.actor_id,a.name AS actor_name,a.email AS actor_email
     ${ACTIVITY_FROM} ${sql} ORDER BY l.created_at DESC,l.id DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
}

export async function adminActivity(db: Database, input: unknown) {
  const query = activityQuery.parse(input);
  const { sql, params } = activityWhere(query);
  const [rows, count] = await Promise.all([
    eventRows(db, query, query.limit, (query.page - 1) * query.limit),
    db
      .prepare(`SELECT COUNT(*) AS n ${ACTIVITY_FROM} ${sql}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);
  return {
    events: rows.map((r) => {
      let details: Record<string, unknown> | null = null;
      try {
        details = r.details ? JSON.parse(r.details) : null;
      } catch {
        details = null;
      }
      return {
        id: r.id,
        createdAt: r.created_at,
        action: r.action,
        label: ACTION_LABELS[r.action as ActivityAction] ?? r.action,
        warning: WARNING_ACTIONS.includes(r.action),
        entity: r.entity,
        entityId: r.entity_id,
        summary: r.summary,
        details,
        ip: r.ip,
        userAgent: r.user_agent,
        user: r.user_id
          ? { id: r.user_id, name: r.user_name, email: r.user_email }
          : null,
        actor: r.actor_id
          ? { id: r.actor_id, name: r.actor_name, email: r.actor_email }
          : null,
      };
    }),
    total: count?.n ?? 0,
    page: query.page,
    limit: query.limit,
  };
}

async function exportActivity(db: Database, input: unknown) {
  const query = activityQuery.parse({ ...(input as object), page: 1, limit: 200 });
  const rows = await eventRows(db, query, 50_000, 0);
  const header = ["Data e hora", "Usuário", "E-mail", "Feito por", "Ação", "Descrição", "IP", "Navegador"];
  const lines = rows.map((r) => [
    spDateTime(r.created_at),
    r.user_name ?? (r.user_id ? "(conta excluída)" : ""),
    r.user_email ?? "",
    r.actor_id && r.actor_id !== r.user_id ? (r.actor_name ?? r.actor_email ?? r.actor_id) : "",
    ACTION_LABELS[r.action as ActivityAction] ?? r.action,
    r.summary,
    r.ip ?? "",
    r.user_agent ?? "",
  ]);
  return { response: csvResponse(header, lines, `auditoria-${todayIn()}.csv`), count: rows.length };
}

/** GET admin/overview, admin/items, admin/activity, their CSV exports and admin/media. Null for other paths. */
export async function handleAdminAuditRoute(
  db: Database,
  admin: Principal,
  request: Request,
  url: URL,
  path: string,
  media?: MediaStore,
): Promise<Response | null> {
  const known =
    ["admin/overview", "admin/items", "admin/items/export.csv", "admin/activity", "admin/activity/export.csv"].includes(path) ||
    path.startsWith("admin/media/");
  if (!known) return null;
  if (request.method !== "GET") throw new HttpError(405, "Método não permitido.");
  const query = Object.fromEntries(url.searchParams);
  const photo = path.match(/^admin\/media\/([^/]+)$/);
  if (photo) return photoResponse(db, null, decodeURIComponent(photo[1]), media);
  if (path === "admin/overview") return json(await adminOverview(db, url.searchParams.get("period")));
  if (path === "admin/items") return json(await adminItems(db, query));
  if (path === "admin/activity") return json(await adminActivity(db, query));
  const actor = actorOf(request, admin.userId);
  if (path === "admin/items/export.csv") {
    const { response, count } = await exportItems(db, query);
    await recordActivity(db, actor, {
      userId: admin.userId,
      action: "admin_export_items",
      entity: "export",
      summary: `Exportou ${count} produtos dos usuários em planilha`,
      details: { filters: query },
    });
    return response;
  }
  const { response, count } = await exportActivity(db, query);
  await recordActivity(db, actor, {
    userId: admin.userId,
    action: "admin_export_activity",
    entity: "export",
    summary: `Exportou ${count} registros da auditoria em planilha`,
    details: { filters: query },
  });
  return response;
}
