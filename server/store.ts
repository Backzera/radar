import { restoreFinancials } from "../core/purchase-policy";
import type {
  Listing,
  Monitor,
  Settings,
  Purchase,
  Alert,
} from "../core/types";
import { DEFAULT_SETTINGS } from "../core/types";
export type Database = Pick<D1Database, "prepare" | "batch">;
export const uid = () => crypto.randomUUID();
export async function batch(db: Database, statements: D1PreparedStatement[]) {
  for (let i = 0; i < statements.length; i += 40)
    await db.batch(statements.slice(i, i + 40));
}
export async function all<T>(
  db: Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  return (
    await db
      .prepare(sql)
      .bind(...params)
      .all<T>()
  ).results;
}
export async function getListings(
  db: Database,
  userId: string,
  limit = 1000,
  realOnly = false,
): Promise<Listing[]> {
  return (
    await all<{ data: string }>(
      db,
      `SELECT data FROM listings WHERE user_id = ? ${realOnly ? "AND demo=0" : ""} ORDER BY last_seen_at DESC LIMIT ?`,
      userId,
      limit,
    )
  ).map((r) => JSON.parse(r.data));
}
export async function getMonitors(
  db: Database,
  userId: string,
): Promise<Monitor[]> {
  return (
    await all<{ config: string; financials: string | null }>(
      db,
      "SELECT config,financials FROM monitors WHERE user_id = ? ORDER BY created_at",
      userId,
    )
  ).map((r) =>
    restoreFinancials(
      {
        maxListingAgeMinutes: 1440,
        minProfit: 0,
        expectedQuickSalePrice: null,
        resultsPerSearch: 10,
        costs: null,
        ...JSON.parse(r.config),
      },
      r.financials,
    ),
  );
}
export async function getSettings(
  db: Database,
  userId: string,
): Promise<Settings> {
  const row = await db
    .prepare("SELECT settings FROM users WHERE id = ?")
    .bind(userId)
    .first<{ settings: string }>();
  return row
    ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.settings) }
    : { ...DEFAULT_SETTINGS };
}
export async function getPurchases(
  db: Database,
  userId: string,
  realOnly = false,
): Promise<Purchase[]> {
  return (
    await all<{ data: string }>(
      db,
      `SELECT data FROM purchases WHERE user_id = ? ${realOnly ? "AND listing_id IN (SELECT id FROM listings WHERE demo=0)" : ""}`,
      userId,
    )
  ).map((r) => JSON.parse(r.data));
}
export async function getAlerts(
  db: Database,
  userId: string,
  realOnly = false,
): Promise<Alert[]> {
  return (
    await all<{ data: string; read: number }>(
      db,
      `SELECT data, read FROM alerts WHERE user_id = ? ${realOnly ? "AND listing_id IN (SELECT id FROM listings WHERE demo=0) AND COALESCE(json_extract(data,'$.demo'),0)=0" : ""} ORDER BY created_at DESC LIMIT 100`,
      userId,
    )
  ).map((r) => ({ ...JSON.parse(r.data), read: !!r.read }));
}
export function listingStatement(db: Database, userId: string, l: Listing) {
  return db
    .prepare(
      "INSERT INTO listings (id,user_id,marketplace,external_id,url,product_key,fingerprint,demo,data,price,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,price=excluded.price,last_seen_at=excluded.last_seen_at,product_key=excluded.product_key,fingerprint=excluded.fingerprint",
    )
    .bind(
      l.id,
      userId,
      l.marketplace,
      l.externalId,
      l.url,
      l.product.key,
      l.fingerprint,
      Number(l.demo),
      JSON.stringify(l),
      l.price,
      l.firstSeenAt,
      l.lastSeenAt,
    );
}
