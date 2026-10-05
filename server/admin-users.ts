/** Owner's user administration: create, block, reset password, change plan, delete. */
import { z } from "zod";
import {
  PLAN_IDS,
  accountSchema,
  accountStatements,
  generatePassword,
  setPassword,
  signupOpen,
} from "./auth";
import type { MediaStore } from "./inventory";
import { json } from "./respond";
import { HttpError, readBoundedJson, type Principal } from "./security";
import { all, uid, type Database } from "./store";

// Every table that holds a person's data. Children of listings and inventory
// items come first so foreign keys never block the delete; users goes last.
// audit_events stays: it is the owner's record of what was done, and it holds
// only ids, so no personal data outlives a deleted account.
const USER_TABLES = [
  "listing_snapshots",
  "deal_pipeline",
  "availability_checks",
  "inventory_costs",
  "inventory_photos",
  "inventory_items",
  "brick_preferences",
  "auth_sessions",
  "auth_credentials",
  "alerts",
  "budget_reservations",
  "channel_tokens",
  "discovery_candidates",
  "discovery_observations",
  "feed_entries",
  "feed_revisions",
  "feed_state",
  "feedback",
  "jobs",
  "listing_preferences",
  "monitor_commands",
  "monitor_scopes",
  "monitor_sightings",
  "notification_destinations",
  "notification_outbox",
  "opportunities",
  "product_events",
  "provider_health",
  "provider_runs",
  "purchases",
  "radar_activations",
  "search_drafts",
  "search_queries",
  "listings",
  "monitors",
  "accounts",
] as const;

const listSchema = z
  .object({
    q: z.string().max(120).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const createSchema = accountSchema
  .extend({ password: accountSchema.shape.password.optional() })
  .strict();

const audit = (db: Database, actor: string, subject: string, action: string) =>
  db
    .prepare(
      "INSERT INTO audit_events (id,actor_id,subject_id,action,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(uid(), actor, subject, action, new Date().toISOString());

async function target(db: Database, userId: string) {
  const row = await db
    .prepare(
      "SELECT c.user_id,c.email,c.name,a.status FROM auth_credentials c JOIN accounts a ON a.user_id=c.user_id WHERE c.user_id=?",
    )
    .bind(userId)
    .first<{ user_id: string; email: string; name: string; status: string }>();
  if (!row) throw new HttpError(404, "Usuário não encontrado.");
  return row;
}
const notSelf = (admin: Principal, userId: string, action: string) => {
  if (admin.userId === userId)
    throw new HttpError(422, `Você não pode ${action} a própria conta.`);
};

export async function listUsers(db: Database, query: unknown) {
  const q = listSchema.parse(query);
  const term = q.q.trim().toLowerCase();
  const users = await all<{
    user_id: string;
    name: string;
    email: string;
    created_at: string;
    last_login_at: string | null;
    status: string;
    plan: string | null;
    items: number;
    sold: number;
  }>(
    db,
    `SELECT c.user_id,c.name,c.email,c.created_at,c.last_login_at,a.status,b.selected_plan AS plan,
      (SELECT COUNT(*) FROM inventory_items i WHERE i.user_id=c.user_id) AS items,
      (SELECT COUNT(*) FROM inventory_items i WHERE i.user_id=c.user_id AND i.status='sold') AS sold
     FROM auth_credentials c JOIN accounts a ON a.user_id=c.user_id
     LEFT JOIN brick_preferences b ON b.user_id=c.user_id
     WHERE (?='' OR instr(lower(c.email),?)>0 OR instr(lower(c.name),?)>0)
     ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    term,
    term,
    term,
    q.limit,
    (q.page - 1) * q.limit,
  );
  const month = new Date().toISOString().slice(0, 7);
  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN a.status='active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN substr(c.created_at,1,7)=? THEN 1 ELSE 0 END) AS new_this_month
       FROM auth_credentials c JOIN accounts a ON a.user_id=c.user_id`,
    )
    .bind(month)
    .first<{
      total: number;
      active: number | null;
      new_this_month: number | null;
    }>();
  return {
    users: users.map((u) => ({
      id: u.user_id,
      name: u.name,
      email: u.email,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
      status: u.status === "active" ? "active" : "blocked",
      plan: u.plan,
      items: Number(u.items),
      sold: Number(u.sold),
    })),
    totals: {
      total: totals?.total ?? 0,
      active: totals?.active ?? 0,
      blocked: (totals?.total ?? 0) - (totals?.active ?? 0),
      newThisMonth: totals?.new_this_month ?? 0,
    },
    signupOpen: await signupOpen(db),
  };
}

export async function deleteUser(
  db: Database,
  admin: Principal,
  userId: string,
  input: unknown,
  media?: MediaStore,
) {
  notSelf(admin, userId, "excluir");
  const user = await target(db, userId);
  const { confirmEmail } = z
    .object({ confirmEmail: z.string().trim().toLowerCase() })
    .strict()
    .parse(input);
  if (confirmEmail !== user.email)
    throw new HttpError(422, "Digite o e-mail do usuário para confirmar.");
  const keys = (
    await all<{ object_key: string }>(
      db,
      "SELECT object_key FROM inventory_photos WHERE user_id=?",
      userId,
    )
  ).map((r) => r.object_key);
  // One transaction: the account is either fully gone or untouched.
  await db.batch([
    ...USER_TABLES.map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(userId),
    ),
    db.prepare("DELETE FROM users WHERE id=?").bind(userId),
    audit(db, admin.userId, userId, "user_deleted"),
  ]);
  for (let i = 0; i < keys.length; i += 1000)
    await media?.delete(keys.slice(i, i + 1000)).catch(() => undefined);
  return { deleted: true, photos: keys.length };
}

/** /api/v1/admin/users and /api/v1/admin/settings. Null for other paths. */
export async function handleAdminUsersRoute(
  db: Database,
  admin: Principal,
  request: Request,
  url: URL,
  path: string,
  media?: MediaStore,
): Promise<Response | null> {
  if (!path.startsWith("admin/users") && path !== "admin/settings") return null;
  if (request.method === "GET") {
    if (path === "admin/users")
      return json(await listUsers(db, Object.fromEntries(url.searchParams)));
    if (path === "admin/settings")
      return json({ signupOpen: await signupOpen(db) });
    throw new HttpError(404, "Rota não encontrada.");
  }
  const body = await readBoundedJson(request);
  if (request.method === "POST" && path === "admin/settings") {
    const { signupOpen: open } = z
      .object({ signupOpen: z.boolean() })
      .strict()
      .parse(body);
    await db.batch([
      db
        .prepare(
          "INSERT INTO app_settings (key,value,updated_at) VALUES ('signup_open',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        )
        .bind(String(open), new Date().toISOString()),
      audit(
        db,
        admin.userId,
        "signup",
        open ? "signup_opened" : "signup_closed",
      ),
    ]);
    return json({ signupOpen: open });
  }
  if (request.method === "POST" && path === "admin/users") {
    const data = createSchema.parse(body);
    const password = data.password ?? generatePassword();
    const account = await accountStatements(db, { ...data, password });
    await db.batch([
      ...account.statements,
      audit(db, admin.userId, account.userId, "user_created"),
    ]);
    return json(
      {
        user: { id: account.userId, name: data.name, email: data.email },
        // Shown once to the owner to hand over; it is never stored in clear.
        temporaryPassword: data.password ? null : password,
      },
      201,
    );
  }
  const m = path.match(/^admin\/users\/([^/]+)(?:\/(status|password|plan))?$/);
  if (!m) throw new HttpError(404, "Rota não encontrada.");
  const userId = decodeURIComponent(m[1]);
  if (request.method === "DELETE" && !m[2])
    return json(await deleteUser(db, admin, userId, body, media));
  if (request.method !== "POST" || !m[2])
    throw new HttpError(405, "Método não permitido.");
  await target(db, userId);
  if (m[2] === "status") {
    const { status } = z
      .object({ status: z.enum(["active", "blocked"]) })
      .strict()
      .parse(body);
    notSelf(admin, userId, "bloquear");
    await db.batch([
      db
        .prepare("UPDATE accounts SET status=? WHERE user_id=?")
        .bind(status === "active" ? "active" : "canceled", userId),
      ...(status === "blocked"
        ? [db.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(userId)]
        : []),
      audit(
        db,
        admin.userId,
        userId,
        status === "active" ? "user_unblocked" : "user_blocked",
      ),
    ]);
    return json({ status });
  }
  if (m[2] === "password") {
    const { password } = z
      .object({ password: accountSchema.shape.password.optional() })
      .strict()
      .parse(body);
    const next = password ?? generatePassword();
    await db.batch([
      ...(await setPassword(db, userId, next)),
      audit(db, admin.userId, userId, "password_reset"),
    ]);
    return json({ temporaryPassword: password ? null : next });
  }
  const { plan } = z
    .object({ plan: z.enum(PLAN_IDS) })
    .strict()
    .parse(body);
  await db.batch([
    db
      .prepare(
        "INSERT INTO brick_preferences (user_id,selected_plan,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET selected_plan=excluded.selected_plan,updated_at=excluded.updated_at",
      )
      .bind(userId, plan, new Date().toISOString()),
    audit(db, admin.userId, userId, `plan_${plan}`),
  ]);
  return json({ plan });
}
