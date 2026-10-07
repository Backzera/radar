/** Trilha de auditoria: grava quem fez o quê, quando e de onde, em português. */
import {
  CATEGORY_LABELS,
  CHANNEL_LABELS,
  CONDITION_LABELS,
  COST_LABELS,
  STATUS_LABELS,
  formatCents,
  type CostKind,
} from "../core/brick";
import type { ActivityAction } from "../core/activity";
import type { getItem } from "./inventory";
import { clientIp } from "./security";
import { uid, type Database } from "./store";

type Item = Awaited<ReturnType<typeof getItem>>;

export interface Actor {
  actorId: string | null;
  ip: string | null;
  userAgent: string | null;
}
export interface ActivityEntry {
  /** Whose account or data the event is about. */
  userId: string | null;
  action: ActivityAction;
  entity?: "item" | "account" | "settings" | "export";
  entityId?: string | null;
  summary: string;
  details?: Record<string, unknown>;
}

export function actorOf(request: Request, actorId: string | null): Actor {
  const ip = clientIp(request);
  return {
    actorId,
    ip: ip === "local" ? null : ip,
    userAgent: request.headers.get("user-agent")?.slice(0, 240) ?? null,
  };
}

/** For batches: the event is saved together with the change it describes. */
export function activityStatement(db: Database, actor: Actor, entry: ActivityEntry) {
  return db
    .prepare(
      "INSERT INTO activity_log (id,created_at,actor_id,user_id,action,entity,entity_id,summary,details,ip,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      uid(),
      new Date().toISOString(),
      actor.actorId,
      entry.userId,
      entry.action,
      entry.entity ?? null,
      entry.entityId ?? null,
      entry.summary.slice(0, 500),
      entry.details ? JSON.stringify(entry.details) : null,
      actor.ip,
      actor.userAgent,
    );
}

/** After the fact: a failed log line never undoes what the person did. */
export async function recordActivity(db: Database, actor: Actor, entry: ActivityEntry | null) {
  if (!entry) return;
  try {
    await activityStatement(db, actor, entry).run();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "activity_log_failed",
        action: entry.action,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** "joao@gmail.com" → "j***@gmail.com": enough to recognize, not to reuse. */
export const maskEmail = (email: string) => {
  const [name, domain = ""] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
};

const money = (cents: number | null | undefined) => formatCents(cents ?? null);
const day = (date: string | null) => (date ? date.split("-").reverse().join("/") : "—");
const text = (value: string | null) => (value ? `“${value}”` : "vazio");

const FIELDS: {
  key: keyof Item;
  label: string;
  show: (value: never) => string;
}[] = [
  { key: "name", label: "nome", show: (v: string) => text(v) },
  { key: "category", label: "categoria", show: (v: keyof typeof CATEGORY_LABELS) => CATEGORY_LABELS[v] },
  { key: "brand", label: "marca", show: (v: string | null) => text(v) },
  { key: "model", label: "modelo", show: (v: string | null) => text(v) },
  { key: "condition", label: "estado", show: (v: keyof typeof CONDITION_LABELS) => CONDITION_LABELS[v] },
  { key: "identifier", label: "IMEI/série", show: (v: string | null) => text(v) },
  { key: "status", label: "etapa", show: (v: keyof typeof STATUS_LABELS) => STATUS_LABELS[v] },
  { key: "purchasePriceCents", label: "valor pago", show: (v: number) => money(v) },
  { key: "purchasedAt", label: "data da compra", show: (v: string) => day(v) },
  { key: "purchaseChannel", label: "comprado em", show: (v: keyof typeof CHANNEL_LABELS) => CHANNEL_LABELS[v] },
  { key: "purchaseFrom", label: "comprado de", show: (v: string | null) => text(v) },
  { key: "askingPriceCents", label: "preço pedido", show: (v: number | null) => money(v) },
  { key: "notes", label: "observações", show: (v: string) => (v ? `${v.length} caracteres` : "vazio") },
];

/** What an admin needs to know about an item, kept even after it is deleted. */
export function itemSnapshot(item: Item) {
  return {
    name: item.name,
    category: item.category,
    brand: item.brand,
    model: item.model,
    condition: item.condition,
    identifier: item.identifier,
    status: item.status,
    purchasePriceCents: item.purchasePriceCents,
    purchasedAt: item.purchasedAt,
    purchaseChannel: item.purchaseChannel,
    askingPriceCents: item.askingPriceCents,
    costsCents: item.costsCents,
    salePriceCents: item.salePriceCents,
    saleFeesCents: item.saleFeesCents,
    soldAt: item.soldAt,
    saleChannel: item.saleChannel,
    photoCount: item.photoCount,
    investedCents: item.figures.investedCents,
    profitCents: item.figures.profitCents,
  };
}

export type ItemChange =
  | "create"
  | "update"
  | "status"
  | "sell"
  | "unsell"
  | "delete"
  | "cost_add"
  | "cost_delete"
  | "photo_add"
  | "photo_delete"
  | "photo_cover";

/** Describes one change to an item from its state before and after. Null when nothing changed. */
export function itemActivity(
  userId: string,
  change: ItemChange,
  before: Item | null,
  after: Item | null,
): ActivityEntry | null {
  const item = after ?? before;
  if (!item) return null;
  const base = { userId, entity: "item" as const, entityId: item.id };
  const name = item.name;
  switch (change) {
    case "create": {
      const sold = item.status === "sold" ? ` · já vendido por ${money(item.salePriceCents)}` : "";
      return {
        ...base,
        action: "item_created",
        summary: `Cadastrou ${name} · compra ${money(item.purchasePriceCents)}${sold}`,
        details: { item: itemSnapshot(item) },
      };
    }
    case "update": {
      if (!before || !after) return null;
      const changes = FIELDS.filter(({ key }) => before[key] !== after[key]).map(
        ({ key, label, show }) => ({
          field: key,
          label,
          from: show(before[key] as never),
          to: show(after[key] as never),
        }),
      );
      if (!changes.length) return null;
      return {
        ...base,
        action: "item_updated",
        summary: `Editou ${name}: ${changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join("; ")}`,
        details: { changes },
      };
    }
    case "status":
      if (!before || !after || before.status === after.status) return null;
      return {
        ...base,
        action: "item_status",
        summary: `Mudou ${name} de ${STATUS_LABELS[before.status]} para ${STATUS_LABELS[after.status]}`,
        details: { from: before.status, to: after.status },
      };
    case "sell": {
      const parts = item.installments.filter((p) => p.number > 0);
      const down = item.installments.find((p) => p.number === 0);
      const plan = parts.length
        ? ` · parcelado: ${down ? `entrada ${money(down.amountCents)} + ` : ""}${parts.length}x (${parts
            .map((p) => `${money(p.amountCents)} em ${day(p.dueDate)}`)
            .join(", ")})`
        : "";
      return {
        ...base,
        action: "item_sold",
        summary: `Vendeu ${name} por ${money(item.salePriceCents)}${item.soldTo ? ` para ${item.soldTo}` : ""} · lucro ${money(item.figures.profitCents)}${plan}`,
        details: {
          installments: item.installments.map((p) => ({ number: p.number, amountCents: p.amountCents, dueDate: p.dueDate })),
          salePriceCents: item.salePriceCents,
          saleFeesCents: item.saleFeesCents,
          soldAt: item.soldAt,
          saleChannel: item.saleChannel,
          investedCents: item.figures.investedCents,
          profitCents: item.figures.profitCents,
          marginPct: item.figures.marginPct,
        },
      };
    }
    case "unsell":
      return {
        ...base,
        action: "item_unsold",
        summary: `Desfez a venda de ${name}${before?.salePriceCents ? ` (era ${money(before.salePriceCents)})` : ""}`,
        details: before ? { sale: { salePriceCents: before.salePriceCents, soldAt: before.soldAt } } : undefined,
      };
    case "delete":
      return {
        ...base,
        action: "item_deleted",
        summary: `Excluiu ${name} · ${STATUS_LABELS[item.status]}, compra ${money(item.purchasePriceCents)}${
          item.status === "sold" ? `, venda ${money(item.salePriceCents)}` : ""
        }`,
        details: { item: itemSnapshot(item) },
      };
    case "cost_add":
    case "cost_delete": {
      if (!before || !after) return null;
      const [from, to] = change === "cost_add" ? [before, after] : [after, before];
      const cost = to.costs.find((c) => !from.costs.some((o) => o.id === c.id));
      if (!cost) return null;
      const kind = COST_LABELS[cost.kind as CostKind] ?? cost.kind;
      const what = `${kind.toLowerCase()} ${money(cost.amountCents)}${cost.description ? ` (${cost.description})` : ""}`;
      return {
        ...base,
        action: change === "cost_add" ? "cost_added" : "cost_deleted",
        summary:
          change === "cost_add"
            ? `Adicionou custo de ${what} em ${name}`
            : `Removeu o custo de ${what} de ${name}`,
        details: { cost },
      };
    }
    case "photo_add":
      return { ...base, action: "photo_added", summary: `Adicionou uma foto em ${name} (${item.photoCount} no total)` };
    case "photo_delete":
      return { ...base, action: "photo_deleted", summary: `Removeu uma foto de ${name}` };
    case "photo_cover":
      return { ...base, action: "photo_cover", summary: `Trocou a foto de capa de ${name}` };
  }
}
