/** Estoque do bricker: itens, custos extras, fotos, venda e resumo. Valores em centavos. */
import { z } from "zod";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CHANNELS,
  CHANNEL_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  COST_KINDS,
  PERIODS,
  STATUSES,
  STATUS_LABELS,
  addDays,
  isValidDate,
  itemFigures,
  summarize,
  todayIn,
  type Category,
  type Status,
} from "../core/brick";
import { all, uid, type Database } from "./store";
import { HttpError } from "./security";

export const MAX_ITEMS = 5000;
export const MAX_PHOTOS = 8;
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** The subset of an R2 bucket the app uses. */
export interface MediaStore {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream } | null>;
  delete(keys: string | string[]): Promise<void>;
}

interface ItemRow {
  id: string;
  name: string;
  category: Category;
  brand: string | null;
  model: string | null;
  condition: (typeof CONDITIONS)[number];
  identifier: string | null;
  notes: string;
  status: Status;
  purchase_price_cents: number;
  purchased_at: string;
  purchase_channel: (typeof CHANNELS)[number];
  purchase_from: string | null;
  asking_price_cents: number | null;
  sale_price_cents: number | null;
  sale_fees_cents: number;
  sold_at: string | null;
  sale_channel: (typeof CHANNELS)[number] | null;
  sold_to: string | null;
  group_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  costs_cents: number;
  cover_photo_id: string | null;
  photo_count: number;
}
const ITEM_SELECT = `SELECT i.*,
  COALESCE((SELECT SUM(c.amount_cents) FROM inventory_costs c WHERE c.user_id=i.user_id AND c.item_id=i.id),0) AS costs_cents,
  (SELECT p.id FROM inventory_photos p WHERE p.user_id=i.user_id AND p.item_id=i.id ORDER BY p.position,p.created_at LIMIT 1) AS cover_photo_id,
  (SELECT COUNT(*) FROM inventory_photos p WHERE p.user_id=i.user_id AND p.item_id=i.id) AS photo_count
  FROM inventory_items i WHERE i.user_id=?`;

function present(row: ItemRow, today: string) {
  const item = {
    id: row.id,
    name: row.name,
    category: row.category,
    brand: row.brand,
    model: row.model,
    condition: row.condition,
    identifier: row.identifier,
    notes: row.notes,
    status: row.status,
    purchasePriceCents: row.purchase_price_cents,
    purchasedAt: row.purchased_at,
    purchaseChannel: row.purchase_channel,
    purchaseFrom: row.purchase_from,
    askingPriceCents: row.asking_price_cents,
    salePriceCents: row.sale_price_cents,
    saleFeesCents: row.sale_fees_cents,
    soldAt: row.sold_at,
    saleChannel: row.sale_channel,
    soldTo: row.sold_to,
    groupId: row.group_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    costsCents: Number(row.costs_cents),
    coverPhotoId: row.cover_photo_id,
    photoCount: Number(row.photo_count),
  };
  return { ...item, figures: itemFigures(item, today) };
}
export type InventoryItem = ReturnType<typeof present>;

const today = () => todayIn();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres.`)
    .nullish()
    .transform((v) => (v ? v : null));
const cents = z
  .number({ invalid_type_error: "Informe um valor." })
  .int()
  .min(0, "O valor não pode ser negativo.")
  .max(100_000_000, "Valor acima do limite.");
const date = z
  .string()
  .refine(isValidDate, "Data inválida.")
  .refine((d) => d <= addDays(today(), 1), "A data não pode estar no futuro.");
const itemFields = {
  name: z
    .string()
    .trim()
    .min(2, "Dê um nome ao produto.")
    .max(120, "Use até 120 caracteres."),
  category: z.enum(CATEGORIES),
  brand: optionalText(80),
  model: optionalText(80),
  condition: z.enum(CONDITIONS),
  identifier: optionalText(64),
  notes: z.string().max(2000, "Use até 2.000 caracteres.").default(""),
  status: z
    .enum(["in_stock", "preparing", "listed", "reserved"])
    .default("in_stock"),
  purchasePriceCents: cents,
  purchasedAt: date,
  purchaseChannel: z.enum(CHANNELS),
  purchaseFrom: optionalText(120),
  askingPriceCents: cents.nullish().transform((v) => v ?? null),
};
const saleSchema = z
  .object({
    salePriceCents: cents.refine((v) => v > 0, "Informe o valor da venda."),
    soldAt: date,
    saleChannel: z.enum(CHANNELS),
    saleFeesCents: cents.default(0),
    soldTo: optionalText(120),
  })
  .strict();
export const MAX_UNITS = 50;
// One unit of a product bought in quantity: its own price and, if already sold, its own sale.
const unitSchema = z
  .object({ purchasePriceCents: cents, sale: saleSchema.optional() })
  .strict();
const createSchema = z
  .object({
    ...itemFields,
    sale: saleSchema.optional(),
    units: z.array(unitSchema).min(2).max(MAX_UNITS).optional(),
  })
  .strict();
const addUnitsSchema = z
  .object({
    units: z.array(unitSchema).min(1).max(MAX_UNITS),
    purchasedAt: date.optional(),
  })
  .strict();
const joinSchema = z
  .object({ ids: z.array(z.string().min(1).max(80)).min(1).max(MAX_UNITS) })
  .strict();
// They describe the product, so every unit of a group keeps the same values.
const SHARED_FIELDS = ["name", "category", "brand", "model"] as const;
const updateSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(itemFields).map(([k, v]) => [k, v.optional()]),
    ),
    expectedVersion: z.number().int().min(1),
  })
  .strict();
const costSchema = z
  .object({
    kind: z.enum(COST_KINDS),
    description: z.string().trim().max(160).default(""),
    amountCents: cents.refine((v) => v > 0, "Informe o valor do custo."),
    spentAt: date,
  })
  .strict();
export const listSchema = z
  .object({
    status: z.enum(["", "open", ...STATUSES]).default(""),
    category: z.enum(["", ...CATEGORIES]).default(""),
    q: z.string().max(120).default(""),
    soldFrom: z.string().refine(isValidDate).optional(),
    soldTo: z.string().refine(isValidDate).optional(),
    sort: z
      .enum(["recent", "purchased", "sold", "profit", "days", "price"])
      .default("recent"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(24),
    /** "1": units of the same product come as one entry with the group's numbers. */
    grouped: z.enum(["0", "1"]).default("0"),
  })
  .strict();
const preferencesSchema = z
  .object({
    monthlyGoalCents: cents.nullable(),
    staleAfterDays: z.number().int().min(7).max(365),
  })
  .strict();

async function itemRows(db: Database, userId: string) {
  return all<ItemRow>(db, `${ITEM_SELECT} ORDER BY i.updated_at DESC`, userId);
}
async function itemRow(db: Database, userId: string, id: string) {
  const row = await db
    .prepare(`${ITEM_SELECT} AND i.id=?`)
    .bind(userId, id)
    .first<ItemRow>();
  if (!row) throw new HttpError(404, "Produto não encontrado.");
  return row;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const sameName = (s: string) => fold(s).replace(/\s+/g, " ").trim();

/** Numbers of a product bought in quantity, from all its units. */
export function groupFigures(units: InventoryItem[]) {
  const sold = units.filter((u) => u.figures.profitCents !== null);
  const open = units.filter((u) => u.figures.profitCents === null);
  const total = (list: InventoryItem[], pick: (u: InventoryItem) => number | null) =>
    list.reduce((t, u) => t + (pick(u) ?? 0), 0);
  return {
    units: units.length,
    sold: sold.length,
    open: open.length,
    openInvestedCents: total(open, (u) => u.figures.investedCents),
    investedCents: total(units, (u) => u.figures.investedCents),
    revenueCents: total(sold, (u) => u.salePriceCents),
    profitCents: total(sold, (u) => u.figures.profitCents),
    expectedProfitCents: open.some((u) => u.figures.expectedProfitCents !== null)
      ? total(open, (u) => u.figures.expectedProfitCents)
      : null,
  };
}

export async function listItems(db: Database, userId: string, query: unknown) {
  const q = listSchema.parse(query),
    t = today();
  const items = (await itemRows(db, userId)).map((r) => present(r, t));
  const terms = fold(q.q).split(/\s+/).filter(Boolean);
  const filtered = items.filter(
    (i) =>
      (!q.status ||
        (q.status === "open" ? i.status !== "sold" : i.status === q.status)) &&
      (!q.category || i.category === q.category) &&
      (!q.soldFrom || (i.soldAt !== null && i.soldAt >= q.soldFrom)) &&
      (!q.soldTo || (i.soldAt !== null && i.soldAt <= q.soldTo)) &&
      terms.every((term) =>
        fold(
          [i.name, i.brand, i.model, i.identifier, i.notes, CATEGORY_LABELS[i.category]]
            .filter(Boolean)
            .join(" "),
        ).includes(term),
      ),
  );
  const by = {
    recent: (a: InventoryItem, b: InventoryItem) => b.updatedAt.localeCompare(a.updatedAt),
    purchased: (a: InventoryItem, b: InventoryItem) => b.purchasedAt.localeCompare(a.purchasedAt),
    sold: (a: InventoryItem, b: InventoryItem) => (b.soldAt ?? "").localeCompare(a.soldAt ?? ""),
    profit: (a: InventoryItem, b: InventoryItem) =>
      (b.figures.profitCents ?? b.figures.expectedProfitCents ?? -Infinity) -
      (a.figures.profitCents ?? a.figures.expectedProfitCents ?? -Infinity),
    days: (a: InventoryItem, b: InventoryItem) => b.figures.days - a.figures.days,
    price: (a: InventoryItem, b: InventoryItem) => b.figures.investedCents - a.figures.investedCents,
  }[q.sort];
  filtered.sort(by);
  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, items.filter((i) => i.status === s).length]),
  ) as Record<Status, number>;
  // Grouped: the first matching unit stands for the product; the numbers cover every unit.
  const groups = new Map<string, InventoryItem[]>();
  for (const i of items)
    if (i.groupId) groups.set(i.groupId, [...(groups.get(i.groupId) ?? []), i]);
  const seen = new Set<string>();
  const entries: (InventoryItem & { group: ReturnType<typeof groupFigures> | null })[] = [];
  for (const i of filtered) {
    const units = i.groupId ? groups.get(i.groupId)! : [];
    if (q.grouped === "0" || units.length < 2) {
      entries.push({ ...i, group: null });
      continue;
    }
    if (seen.has(i.groupId!)) continue;
    seen.add(i.groupId!);
    entries.push({
      ...i,
      coverPhotoId: i.coverPhotoId ?? units.find((u) => u.coverPhotoId)?.coverPhotoId ?? null,
      group: groupFigures(units),
    });
  }
  return {
    items: entries.slice((q.page - 1) * q.limit, q.page * q.limit),
    total: entries.length,
    page: q.page,
    limit: q.limit,
    counts: { ...counts, all: items.length, open: items.length - counts.sold },
  };
}

export async function getItem(db: Database, userId: string, id: string) {
  const item = present(await itemRow(db, userId, id), today());
  const [photos, costs] = await Promise.all([
    all<{ id: string; position: number }>(
      db,
      "SELECT id,position FROM inventory_photos WHERE user_id=? AND item_id=? ORDER BY position,created_at",
      userId,
      id,
    ),
    all<{
      id: string;
      kind: string;
      description: string;
      amount_cents: number;
      spent_at: string;
    }>(
      db,
      "SELECT id,kind,description,amount_cents,spent_at FROM inventory_costs WHERE user_id=? AND item_id=? ORDER BY spent_at DESC,created_at DESC",
      userId,
      id,
    ),
  ]);
  // The other units of the product, and same-name products still registered apart.
  const siblings = item.groupId
    ? (
        await all<ItemRow>(
          db,
          `${ITEM_SELECT} AND i.group_id=? ORDER BY i.created_at,i.id`,
          userId,
          item.groupId,
        )
      ).map((r) => present(r, today()))
    : [];
  const name = sameName(item.name);
  const similar = (
    await all<{ id: string; name: string; status: Status; purchase_price_cents: number; group_id: string | null }>(
      db,
      "SELECT id,name,status,purchase_price_cents,group_id FROM inventory_items WHERE user_id=? AND id<>? AND (group_id IS NULL OR group_id<>?)",
      userId,
      id,
      item.groupId ?? "",
    )
  )
    .filter((r) => sameName(r.name) === name)
    .slice(0, MAX_UNITS)
    .map((r) => ({ id: r.id, status: r.status, purchasePriceCents: r.purchase_price_cents, groupId: r.group_id }));
  return {
    ...item,
    group:
      siblings.length > 1
        ? {
            id: item.groupId!,
            position: siblings.findIndex((u) => u.id === item.id) + 1,
            coverPhotoId: siblings.find((u) => u.coverPhotoId)?.coverPhotoId ?? null,
            ...groupFigures(siblings),
            list: siblings.map((u) => ({
              id: u.id,
              status: u.status,
              purchasePriceCents: u.purchasePriceCents,
              askingPriceCents: u.askingPriceCents,
              salePriceCents: u.salePriceCents,
              soldAt: u.soldAt,
              soldTo: u.soldTo,
              investedCents: u.figures.investedCents,
              profitCents: u.figures.profitCents,
            })),
          }
        : null,
    similar,
    photos,
    costs: costs.map((c) => ({
      id: c.id,
      kind: c.kind,
      description: c.description,
      amountCents: c.amount_cents,
      spentAt: c.spent_at,
    })),
  };
}

const saleAfterPurchase = (purchasedAt: string, soldAt: string) => {
  if (soldAt < purchasedAt)
    throw new HttpError(422, "A data da venda não pode ser antes da compra.");
};

type Unit = z.infer<typeof unitSchema>;
type ProductData = Omit<z.infer<typeof createSchema>, "units" | "sale" | "purchasePriceCents">;
async function roomFor(db: Database, userId: string, adding: number) {
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE user_id=?")
    .bind(userId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) + adding > MAX_ITEMS)
    throw new HttpError(422, "Limite de produtos atingido.");
}
function unitStatement(
  db: Database,
  userId: string,
  id: string,
  data: ProductData,
  unit: Unit,
  groupId: string | null,
  createdAt: string,
) {
  return db
    .prepare(
      `INSERT INTO inventory_items (id,user_id,name,category,brand,model,condition,identifier,notes,status,
        purchase_price_cents,purchased_at,purchase_channel,purchase_from,asking_price_cents,
        sale_price_cents,sale_fees_cents,sold_at,sale_channel,sold_to,group_id,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    )
    .bind(
      id,
      userId,
      data.name,
      data.category,
      data.brand,
      data.model,
      data.condition,
      data.identifier,
      data.notes,
      unit.sale ? "sold" : data.status,
      unit.purchasePriceCents,
      data.purchasedAt,
      data.purchaseChannel,
      data.purchaseFrom,
      data.askingPriceCents,
      unit.sale?.salePriceCents ?? null,
      unit.sale?.saleFeesCents ?? 0,
      unit.sale?.soldAt ?? null,
      unit.sale?.saleChannel ?? null,
      unit.sale?.soldTo ?? null,
      groupId,
      createdAt,
      createdAt,
    );
}
/** Inserts the units in one transaction; they are created 1 ms apart to keep the typed order. */
async function insertUnits(
  db: Database,
  userId: string,
  data: ProductData,
  units: Unit[],
  groupId: string | null,
  extra: D1PreparedStatement[] = [],
) {
  for (const u of units) if (u.sale) saleAfterPurchase(data.purchasedAt, u.sale.soldAt);
  const ids = units.map(() => uid());
  const start = Date.now();
  await db.batch([
    ...extra,
    ...units.map((u, k) =>
      unitStatement(db, userId, ids[k], data, u, groupId, new Date(start + k).toISOString()),
    ),
  ]);
  return ids;
}

/** One product, or several units of it (`units`), each with its own price and sale. Returns the new ids. */
export async function createItems(db: Database, userId: string, input: unknown) {
  const { units: many, sale, purchasePriceCents, ...data } = createSchema.parse(input);
  const units: Unit[] = many ?? [{ purchasePriceCents, sale }];
  await roomFor(db, userId, units.length);
  return insertUnits(db, userId, data, units, units.length > 1 ? uid() : null);
}
export async function createItem(db: Database, userId: string, input: unknown) {
  return getItem(db, userId, (await createItems(db, userId, input))[0]);
}

/** More units of a product already registered; a single product becomes a group. */
export async function addUnits(db: Database, userId: string, id: string, input: unknown) {
  const { units, purchasedAt } = addUnitsSchema.parse(input);
  const row = await itemRow(db, userId, id);
  await roomFor(db, userId, units.length);
  const groupId = row.group_id ?? uid();
  const data: ProductData = {
    name: row.name,
    category: row.category,
    brand: row.brand,
    model: row.model,
    condition: row.condition,
    identifier: null,
    notes: "",
    status: row.status === "sold" ? "in_stock" : row.status,
    purchasedAt: purchasedAt ?? row.purchased_at,
    purchaseChannel: row.purchase_channel,
    purchaseFrom: row.purchase_from,
    askingPriceCents: row.asking_price_cents,
  };
  const ids = await insertUnits(db, userId, data, units, groupId, row.group_id
    ? []
    : [
        db
          .prepare("UPDATE inventory_items SET group_id=?,version=version+1,updated_at=? WHERE id=? AND user_id=?")
          .bind(groupId, new Date().toISOString(), id, userId),
      ]);
  return {
    item: await getItem(db, userId, id),
    created: await Promise.all(ids.map((i) => getItem(db, userId, i))),
  };
}

/** The same product registered apart: the chosen items become units of this one. */
export async function joinUnits(db: Database, userId: string, id: string, input: unknown) {
  const { ids } = joinSchema.parse(input);
  const row = await itemRow(db, userId, id);
  const others = [...new Set(ids)].filter((other) => other !== id);
  type Member = Pick<ItemRow, "id" | "group_id" | "name" | "category" | "brand" | "model">;
  const owned = others.length
    ? await all<Member>(
        db,
        `SELECT id,group_id,name,category,brand,model FROM inventory_items WHERE user_id=? AND id IN (${others.map(() => "?").join(",")})`,
        userId,
        ...others,
      )
    : [];
  if (!others.length || owned.length !== others.length)
    throw new HttpError(404, "Produto não encontrado.");
  // A group that already exists keeps its id and its name; loose items join it.
  const base: Member = row.group_id ? row : (owned.find((o) => o.group_id) ?? row);
  const groupId = base.group_id ?? uid();
  const now = new Date().toISOString();
  const shared = SHARED_FIELDS.map((f) => `${COLUMN[f]}=?`).join(",");
  await db.batch(
    [id, ...others].map((target) =>
      db
        .prepare(
          `UPDATE inventory_items SET group_id=?,${shared},version=version+1,updated_at=? WHERE id=? AND user_id=?`,
        )
        .bind(groupId, base.name, base.category, base.brand, base.model, now, target, userId),
    ),
  );
  return getItem(db, userId, id);
}

/** The unit stops being part of its group; a group left with one unit is a plain product again. */
export async function leaveUnits(db: Database, userId: string, id: string) {
  const row = await itemRow(db, userId, id);
  if (!row.group_id) return getItem(db, userId, id);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("UPDATE inventory_items SET group_id=NULL,version=version+1,updated_at=? WHERE id=? AND user_id=?")
      .bind(now, id, userId),
    db
      .prepare(
        "UPDATE inventory_items SET group_id=NULL WHERE user_id=? AND group_id=? AND (SELECT COUNT(*) FROM inventory_items g WHERE g.user_id=? AND g.group_id=?)<2",
      )
      .bind(userId, row.group_id, userId, row.group_id),
  ]);
  return getItem(db, userId, id);
}

const COLUMN: Record<string, string> = {
  name: "name",
  category: "category",
  brand: "brand",
  model: "model",
  condition: "condition",
  identifier: "identifier",
  notes: "notes",
  status: "status",
  purchasePriceCents: "purchase_price_cents",
  purchasedAt: "purchased_at",
  purchaseChannel: "purchase_channel",
  purchaseFrom: "purchase_from",
  askingPriceCents: "asking_price_cents",
};
export async function updateItem(
  db: Database,
  userId: string,
  id: string,
  input: unknown,
) {
  const { expectedVersion, ...changes } = updateSchema.parse(input) as Record<
    string,
    unknown
  > & { expectedVersion: number };
  const current = await itemRow(db, userId, id);
  if (current.version !== expectedVersion)
    throw new HttpError(
      409,
      "Este produto foi alterado em outra janela. Recarregue antes de editar.",
    );
  if (current.status === "sold" && changes.status !== undefined)
    throw new HttpError(422, "Desfaça a venda antes de mudar a etapa.");
  if (current.sold_at && typeof changes.purchasedAt === "string")
    saleAfterPurchase(changes.purchasedAt, current.sold_at);
  const keys = Object.keys(changes).filter((k) => changes[k] !== undefined);
  if (!keys.length) return getItem(db, userId, id);
  const result = await db
    .prepare(
      `UPDATE inventory_items SET ${keys.map((k) => `${COLUMN[k]}=?`).join(",")},version=version+1,updated_at=? WHERE id=? AND user_id=? AND version=?`,
    )
    .bind(
      ...keys.map((k) => changes[k]),
      new Date().toISOString(),
      id,
      userId,
      expectedVersion,
    )
    .run();
  if (!result.meta.changes)
    throw new HttpError(
      409,
      "Este produto foi alterado em outra janela. Recarregue antes de editar.",
    );
  // Name, category, brand and model belong to the product: every unit follows.
  const shared = SHARED_FIELDS.filter((k) => keys.includes(k));
  if (current.group_id && shared.length)
    await db
      .prepare(
        `UPDATE inventory_items SET ${shared.map((k) => `${COLUMN[k]}=?`).join(",")},version=version+1,updated_at=? WHERE user_id=? AND group_id=? AND id<>?`,
      )
      .bind(...shared.map((k) => changes[k]), new Date().toISOString(), userId, current.group_id, id)
      .run();
  return getItem(db, userId, id);
}

export async function setStatus(
  db: Database,
  userId: string,
  id: string,
  input: unknown,
) {
  const { status } = z
    .object({ status: z.enum(["in_stock", "preparing", "listed", "reserved"]) })
    .strict()
    .parse(input);
  const current = await itemRow(db, userId, id);
  if (current.status === "sold")
    throw new HttpError(422, "Desfaça a venda antes de mudar a etapa.");
  await db
    .prepare(
      "UPDATE inventory_items SET status=?,version=version+1,updated_at=? WHERE id=? AND user_id=?",
    )
    .bind(status, new Date().toISOString(), id, userId)
    .run();
  return getItem(db, userId, id);
}

export async function sellItem(
  db: Database,
  userId: string,
  id: string,
  input: unknown,
) {
  const sale = saleSchema.parse(input);
  const current = await itemRow(db, userId, id);
  saleAfterPurchase(current.purchased_at, sale.soldAt);
  await db
    .prepare(
      "UPDATE inventory_items SET status='sold',sale_price_cents=?,sale_fees_cents=?,sold_at=?,sale_channel=?,sold_to=?,version=version+1,updated_at=? WHERE id=? AND user_id=?",
    )
    .bind(
      sale.salePriceCents,
      sale.saleFeesCents,
      sale.soldAt,
      sale.saleChannel,
      sale.soldTo,
      new Date().toISOString(),
      id,
      userId,
    )
    .run();
  return getItem(db, userId, id);
}

export async function unsellItem(db: Database, userId: string, id: string) {
  await itemRow(db, userId, id);
  await db
    .prepare(
      "UPDATE inventory_items SET status='listed',sale_price_cents=NULL,sale_fees_cents=0,sold_at=NULL,sale_channel=NULL,sold_to=NULL,version=version+1,updated_at=? WHERE id=? AND user_id=?",
    )
    .bind(new Date().toISOString(), id, userId)
    .run();
  return getItem(db, userId, id);
}

export async function deleteItem(
  db: Database,
  userId: string,
  id: string,
  media?: MediaStore,
) {
  await itemRow(db, userId, id);
  const keys = (
    await all<{ object_key: string }>(
      db,
      "SELECT object_key FROM inventory_photos WHERE user_id=? AND item_id=?",
      userId,
      id,
    )
  ).map((r) => r.object_key);
  // Costs and photos go explicitly: the rows must vanish even where foreign
  // keys are off. A failed media delete leaves an orphan file, not a broken item.
  await db.batch([
    db
      .prepare("DELETE FROM inventory_costs WHERE user_id=? AND item_id=?")
      .bind(userId, id),
    db
      .prepare("DELETE FROM inventory_photos WHERE user_id=? AND item_id=?")
      .bind(userId, id),
    db
      .prepare("DELETE FROM inventory_items WHERE user_id=? AND id=?")
      .bind(userId, id),
  ]);
  if (keys.length && media) await media.delete(keys).catch(() => undefined);
  return { deleted: true };
}

export async function addCost(
  db: Database,
  userId: string,
  itemId: string,
  input: unknown,
) {
  const cost = costSchema.parse(input);
  await itemRow(db, userId, itemId);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO inventory_costs (id,user_id,item_id,kind,description,amount_cents,spent_at,created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(
        uid(),
        userId,
        itemId,
        cost.kind,
        cost.description,
        cost.amountCents,
        cost.spentAt,
        now,
      ),
    db
      .prepare(
        "UPDATE inventory_items SET updated_at=? WHERE id=? AND user_id=?",
      )
      .bind(now, itemId, userId),
  ]);
  return getItem(db, userId, itemId);
}

export async function deleteCost(
  db: Database,
  userId: string,
  itemId: string,
  costId: string,
) {
  const result = await db
    .prepare(
      "DELETE FROM inventory_costs WHERE id=? AND user_id=? AND item_id=?",
    )
    .bind(costId, userId, itemId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Custo não encontrado.");
  return getItem(db, userId, itemId);
}

/** Detects the real image type from its first bytes; the header is not trusted. */
export function imageType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { type: "image/jpeg", ext: "jpg" };
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return { type: "image/png", ext: "png" };
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return { type: "image/webp", ext: "webp" };
  return null;
}
async function readImage(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(422, "Envie uma imagem.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PHOTO_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "A foto passa de 3 MB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
export async function addPhoto(
  db: Database,
  userId: string,
  itemId: string,
  request: Request,
  media?: MediaStore,
) {
  if (!media)
    throw new HttpError(503, "O armazenamento de fotos não está configurado.");
  const item = await itemRow(db, userId, itemId);
  if (item.photo_count >= MAX_PHOTOS)
    throw new HttpError(422, `Cada produto aceita até ${MAX_PHOTOS} fotos.`);
  const bytes = await readImage(request);
  const kind = imageType(bytes);
  if (!kind) throw new HttpError(415, "Use uma foto JPG, PNG ou WebP.");
  const id = uid();
  const key = `brick/${userId.replace(/[^A-Za-z0-9_-]/g, "_")}/${itemId}/${id}.${kind.ext}`;
  await media.put(key, bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer, {
    httpMetadata: { contentType: kind.type },
  });
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO inventory_photos (id,user_id,item_id,object_key,content_type,bytes,position,created_at) VALUES (?,?,?,?,?,?,(SELECT COALESCE(MAX(position)+1,0) FROM inventory_photos WHERE user_id=? AND item_id=?),?)",
      )
      .bind(id, userId, itemId, key, kind.type, bytes.byteLength, userId, itemId, now),
    db
      .prepare("UPDATE inventory_items SET updated_at=? WHERE id=? AND user_id=?")
      .bind(now, itemId, userId),
  ]);
  return getItem(db, userId, itemId);
}

async function photoRow(db: Database, userId: string, itemId: string, photoId: string) {
  const row = await db
    .prepare(
      "SELECT object_key,position FROM inventory_photos WHERE id=? AND user_id=? AND item_id=?",
    )
    .bind(photoId, userId, itemId)
    .first<{ object_key: string; position: number }>();
  if (!row) throw new HttpError(404, "Foto não encontrada.");
  return row;
}
export async function deletePhoto(
  db: Database,
  userId: string,
  itemId: string,
  photoId: string,
  media?: MediaStore,
) {
  const row = await photoRow(db, userId, itemId, photoId);
  await db
    .prepare("DELETE FROM inventory_photos WHERE id=? AND user_id=?")
    .bind(photoId, userId)
    .run();
  await media?.delete(row.object_key).catch(() => undefined);
  return getItem(db, userId, itemId);
}
export async function coverPhoto(
  db: Database,
  userId: string,
  itemId: string,
  photoId: string,
) {
  await photoRow(db, userId, itemId, photoId);
  await db
    .prepare(
      "UPDATE inventory_photos SET position=(SELECT MIN(position)-1 FROM inventory_photos WHERE user_id=? AND item_id=?) WHERE id=? AND user_id=?",
    )
    .bind(userId, itemId, photoId, userId)
    .run();
  return getItem(db, userId, itemId);
}
/** A photo of the user's own items; null userId is the admin, who sees any photo. */
export async function photoResponse(
  db: Database,
  userId: string | null,
  photoId: string,
  media?: MediaStore,
) {
  const row = await db
    .prepare(
      "SELECT object_key,content_type FROM inventory_photos WHERE id=? AND (? IS NULL OR user_id=?)",
    )
    .bind(photoId, userId, userId)
    .first<{ object_key: string; content_type: string }>();
  const object = row && media ? await media.get(row.object_key) : null;
  if (!row || !object) throw new HttpError(404, "Foto não encontrada.");
  return new Response(object.body, {
    headers: {
      "Content-Type": row.content_type,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}

export async function getPreferences(db: Database, userId: string) {
  const row = await db
    .prepare(
      "SELECT monthly_goal_cents,stale_after_days,selected_plan FROM brick_preferences WHERE user_id=?",
    )
    .bind(userId)
    .first<{
      monthly_goal_cents: number | null;
      stale_after_days: number;
      selected_plan: string | null;
    }>();
  return {
    monthlyGoalCents: row?.monthly_goal_cents ?? null,
    staleAfterDays: row?.stale_after_days ?? 30,
    selectedPlan: row?.selected_plan ?? null,
  };
}
export async function savePreferences(
  db: Database,
  userId: string,
  input: unknown,
) {
  const data = preferencesSchema.parse(input);
  await db
    .prepare(
      "INSERT INTO brick_preferences (user_id,monthly_goal_cents,stale_after_days,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET monthly_goal_cents=excluded.monthly_goal_cents,stale_after_days=excluded.stale_after_days,updated_at=excluded.updated_at",
    )
    .bind(userId, data.monthlyGoalCents, data.staleAfterDays, new Date().toISOString())
    .run();
  return getPreferences(db, userId);
}

export async function inventorySummary(
  db: Database,
  userId: string,
  period: string | null,
) {
  const p = z.enum(PERIODS).default("month").parse(period ?? undefined);
  const [rows, prefs] = await Promise.all([
    itemRows(db, userId),
    getPreferences(db, userId),
  ]);
  const t = today();
  return summarize(
    rows.map((r) => {
      const i = present(r, t);
      return {
        id: i.id,
        name: i.name,
        category: i.category,
        coverPhotoId: i.coverPhotoId,
        status: i.status,
        purchasePriceCents: i.purchasePriceCents,
        costsCents: i.costsCents,
        askingPriceCents: i.askingPriceCents,
        salePriceCents: i.salePriceCents,
        saleFeesCents: i.saleFeesCents,
        purchasedAt: i.purchasedAt,
        soldAt: i.soldAt,
      };
    }),
    {
      period: p,
      today: t,
      goalCents: prefs.monthlyGoalCents,
      staleAfterDays: prefs.staleAfterDays,
    },
  );
}

export const csvMoney = (c: number | null) =>
  c == null ? "" : (c / 100).toFixed(2).replace(".", ",");
/** Spreadsheet download: ";" and comma decimals open cleanly in Brazilian Excel. */
export function csvResponse(header: string[], rows: unknown[][], filename: string) {
  const cell = (value: unknown) => {
    let text = value == null ? "" : String(value);
    // Formula injection guard: a cell must never start an Excel formula.
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [header, ...rows].map((row) => row.map(cell).join(";"));
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function exportCsv(db: Database, userId: string) {
  const t = today();
  const items = (await itemRows(db, userId)).map((r) => present(r, t));
  const money = csvMoney;
  const header = [
    "Produto",
    "Categoria",
    "Marca",
    "Modelo",
    "Estado",
    "IMEI/Série",
    "Etapa",
    "Data da compra",
    "Comprado em",
    "Valor pago",
    "Custos extras",
    "Total investido",
    "Preço pedido",
    "Data da venda",
    "Vendido em",
    "Cliente",
    "Valor da venda",
    "Taxas da venda",
    "Lucro",
    "Margem %",
    "Dias em estoque",
    "Observações",
  ];
  const rows = items.map((i) => [
      i.name,
      CATEGORY_LABELS[i.category],
      i.brand,
      i.model,
      CONDITION_LABELS[i.condition],
      i.identifier,
      STATUS_LABELS[i.status],
      i.purchasedAt,
      CHANNEL_LABELS[i.purchaseChannel],
      money(i.purchasePriceCents),
      money(i.costsCents),
      money(i.figures.investedCents),
      money(i.askingPriceCents),
      i.soldAt,
      i.saleChannel ? CHANNEL_LABELS[i.saleChannel] : "",
      i.soldTo,
      money(i.salePriceCents),
      i.status === "sold" ? money(i.saleFeesCents) : "",
      money(i.figures.profitCents),
      i.figures.marginPct == null ? "" : String(i.figures.marginPct).replace(".", ","),
      i.figures.days,
      i.notes,
    ]);
  return csvResponse(header, rows, `estoque-${t}.csv`);
}
