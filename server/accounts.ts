import { z } from "zod";
import { all, uid, type Database } from "./store";
import { ensureUser } from "./seed";
import { providerBudgetKey } from "./pilot";
export interface Account {
  user_id: string;
  status: "active" | "canceled";
  plan_id: string;
  name: string;
  max_active: number;
  min_interval: number;
  daily_triggers: number;
  telegram: number;
  preferences: string;
}
export const tenantBudgetKey = (userId: string, provider = "brightdata") =>
  `${providerBudgetKey(provider)}:account:${userId}`;
export async function getAccount(db: Database, userId: string) {
  await ensureUser(db, userId);
  return (await db
    .prepare(
      "SELECT a.*,p.name,p.max_active,p.min_interval,p.daily_triggers,p.telegram FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE a.user_id=?",
    )
    .bind(userId)
    .first<Account>())!;
}
export async function accountView(db: Database, userId: string) {
  const a = await getAccount(db, userId);
  const used = await db
    .prepare("SELECT count FROM rate_limits WHERE key=?")
    .bind(tenantBudgetKey(userId))
    .first<{ count: number }>();
  const channel = await db
    .prepare(
      "SELECT enabled,verified_at FROM notification_destinations WHERE user_id=? AND channel='telegram'",
    )
    .bind(userId)
    .first<{ enabled: number; verified_at: string }>();
  return {
    status: a.status,
    preferences: JSON.parse(a.preferences),
    plan: {
      id: a.plan_id,
      name: a.name,
      maxActive: a.max_active,
      minInterval: a.min_interval,
      dailyTriggers: a.daily_triggers,
      telegram: !!a.telegram,
    },
    usedToday: used?.count ?? 0,
    resetsAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
    telegram: channel
      ? { enabled: !!channel.enabled, verifiedAt: channel.verified_at }
      : null,
    billing: {
      available: false,
      reason:
        "Cobrança externa ainda não configurada. O acesso é administrado.",
    },
  };
}
export async function reserveAccountBudget(
  db: Database,
  userId: string,
  id: string,
  provider: string,
  globalLimit: number,
  tenantLimit: number,
) {
  if (
    !Number.isSafeInteger(globalLimit) ||
    !Number.isSafeInteger(tenantLimit) ||
    globalLimit < 1 ||
    tenantLimit < 1
  )
    return false;
  const globalKey = providerBudgetKey(provider),
    tenantKey = `${globalKey}:account:${userId}`;
  const previous = await db
    .prepare("SELECT user_id,refunded FROM budget_reservations WHERE id=?")
    .bind(id)
    .first<{ user_id: string; refunded: number }>();
  if (previous) return previous.user_id === userId && !previous.refunded;
  // One INSERT and its triggers are atomic. A race cannot spend half of the pair.
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO budget_reservations(id,user_id,global_key,tenant_key,created_at)
    SELECT ?,?,?,?,? WHERE COALESCE((SELECT count FROM rate_limits WHERE key=?),0)<? AND COALESCE((SELECT count FROM rate_limits WHERE key=?),0)<?`,
    )
    .bind(
      id,
      userId,
      globalKey,
      tenantKey,
      new Date().toISOString(),
      globalKey,
      globalLimit,
      tenantKey,
      tenantLimit,
    )
    .run();
  if (r.meta.changes) return true;
  return !!(await db
    .prepare(
      "SELECT id FROM budget_reservations WHERE id=? AND user_id=? AND refunded=0",
    )
    .bind(id, userId)
    .first());
}
export async function refundAccountBudget(
  db: Database,
  userId: string,
  id: string,
) {
  await db
    .prepare(
      "UPDATE budget_reservations SET refunded=1 WHERE id=? AND user_id=? AND refunded=0",
    )
    .bind(id, userId)
    .run();
}
export const accountPreferences = z
  .object({
    city: z.string().max(160).optional(),
    radiusKm: z.number().min(0).max(500).optional(),
    intent: z.enum(["personal", "resale"]),
    notifyNew: z.boolean(),
    notifyDrops: z.boolean(),
  })
  .strict();
export async function saveAccountPreferences(
  db: Database,
  userId: string,
  input: unknown,
) {
  const current = await getAccount(db, userId);
  const data = accountPreferences.parse({
    ...JSON.parse(current.preferences),
    ...(input as Record<string, unknown>),
  });
  await db
    .prepare("UPDATE accounts SET preferences=? WHERE user_id=?")
    .bind(JSON.stringify(data), userId)
    .run();
  return data;
}
export async function cancelAccount(
  db: Database,
  userId: string,
  confirmation: string,
) {
  if (confirmation !== "CANCELAR ACESSO")
    throw new Error("CONFIRMATION_REQUIRED");
  await db.batch([
    db
      .prepare("UPDATE accounts SET status='canceled' WHERE user_id=?")
      .bind(userId),
    db
      .prepare(
        "UPDATE monitors SET active=0,config=json_set(config,'$.active',json('false'),'$.version',COALESCE(json_extract(config,'$.version'),0)+1) WHERE user_id=?",
      )
      .bind(userId),
    db
      .prepare("UPDATE notification_destinations SET enabled=0 WHERE user_id=?")
      .bind(userId),
    db
      .prepare(
        "UPDATE notification_outbox SET status='failed',error='Acesso cancelado pelo titular' WHERE user_id=? AND status='pending'",
      )
      .bind(userId),
    db
      .prepare("INSERT INTO audit_events VALUES (?,?,?,?,?)")
      .bind(
        uid(),
        userId,
        userId,
        "account_canceled",
        new Date().toISOString(),
      ),
  ]);
  return { canceled: true, deleted: false, billingCanceled: false };
}
export async function recordEvent(
  db: Database,
  userId: string,
  event: string,
  subjectId?: string,
) {
  if (
    ![
      "search_saved",
      "listing_saved",
      "listing_dismissed",
      "first_useful_result",
      "channel_linked",
      "feedback_recorded",
    ].includes(event)
  )
    throw new Error("INVALID_EVENT");
  await db
    .prepare("INSERT INTO product_events VALUES (?,?,?,?,?)")
    .bind(uid(), userId, event, subjectId ?? null, new Date().toISOString())
    .run();
}
export async function accountMetrics(db: Database, userId: string) {
  return all<{ event: string; count: number }>(
    db,
    "SELECT event,COUNT(*) AS count FROM product_events WHERE user_id=? GROUP BY event",
    userId,
  );
}
