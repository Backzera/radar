/** Contas próprias por e-mail e senha. O banco guarda só o hash da senha e o hash do token de sessão. */
import { z } from "zod";
import { DEFAULT_SETTINGS } from "../core/types";
import { uid, type Database } from "./store";
import {
  equalSecret,
  HttpError,
  readBoundedJson,
  type Principal,
  type RuntimeConfig,
} from "./security";
import { json } from "./respond";

export const SESSION_COOKIE = "brick_session";
const SESSION_DAYS = 30;
// Cloudflare Workers caps PBKDF2 at 100k iterations.
const ITERATIONS = 100_000;
const encoder = new TextEncoder();

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromBase64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const randomToken = (bytes = 32) =>
  base64url(crypto.getRandomValues(new Uint8Array(bytes)));
async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPassword(
  password: string,
  salt = randomToken(16),
  iterations = ITERATIONS,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64url(salt), iterations },
    key,
    256,
  );
  return { hash: base64url(new Uint8Array(bits)), salt, iterations };
}
// Verifies against a fixed dummy when the e-mail is unknown, so a missing
// account takes as long to reject as a wrong password.
const DUMMY = { hash: "x".repeat(43), salt: "AAAAAAAAAAAAAAAAAAAAAA", iterations: ITERATIONS };
async function verifyPassword(
  password: string,
  stored: { hash: string; salt: string; iterations: number } | null,
) {
  const target = stored ?? DUMMY;
  const attempt = await hashPassword(password, target.salt, target.iterations);
  return (await equalSecret(attempt.hash, target.hash)) && stored !== null;
}

function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}
function sessionCookie(request: Request, token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export function isAdmin(
  config: RuntimeConfig,
  userId: string,
  email?: string | null,
) {
  const list = (value?: string) =>
    (value ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  return (
    list(config.RADAR_ADMIN_IDS).includes(userId.toLowerCase()) ||
    (!!email && list(config.RADAR_ADMIN_EMAILS).includes(email.toLowerCase()))
  );
}

/** Principal of a valid session cookie, or null. */
export async function sessionPrincipal(
  db: Database,
  request: Request,
  config: RuntimeConfig,
): Promise<Principal | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db
    .prepare(
      "SELECT s.user_id,s.expires_at,c.email,c.name FROM auth_sessions s JOIN auth_credentials c ON c.user_id=s.user_id WHERE s.id=? AND s.expires_at>?",
    )
    .bind(await sha256(token), new Date().toISOString())
    .first<{ user_id: string; expires_at: string; email: string; name: string }>();
  if (!row) return null;
  return {
    kind: "user",
    userId: row.user_id,
    admin: isAdmin(config, row.user_id, row.email),
    expiresAt: Date.parse(row.expires_at),
    email: row.email,
    name: row.name,
  };
}

async function startSession(db: Database, request: Request, userId: string) {
  const token = randomToken(),
    now = new Date();
  const statement = db
    .prepare(
      "INSERT INTO auth_sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)",
    )
    .bind(
      await sha256(token),
      userId,
      now.toISOString(),
      new Date(+now + SESSION_DAYS * 86_400_000).toISOString(),
    );
  return {
    statement,
    cookie: sessionCookie(request, token, SESSION_DAYS * 86_400),
  };
}

async function limited(db: Database, key: string, windowMs: number, max: number) {
  const window = Math.floor(Date.now() / windowMs);
  const row = await db
    .prepare(
      "INSERT INTO rate_limits(key,window,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count",
    )
    .bind(key, window)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > max)
    throw new HttpError(
      429,
      "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
    );
}

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("Informe um e-mail válido.");
const password = z
  .string()
  .min(8, "A senha precisa ter pelo menos 8 caracteres.")
  .max(128, "A senha pode ter no máximo 128 caracteres.");
const signupSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Informe seu nome.")
      .max(80, "Use até 80 caracteres."),
    email,
    password,
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: "Aceite os termos para continuar." }),
    }),
    plan: z.enum(["essencial", "pro"]).optional(),
  })
  .strict();
const loginSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();

/** Public routes: sign-up, sign-in, sign-out. Returns null for other paths. */
export async function handleAuthRoute(
  db: Database,
  request: Request,
  path: string,
): Promise<Response | null> {
  if (!["auth/signup", "auth/login", "auth/logout"].includes(path)) return null;
  if (request.method !== "POST")
    throw new HttpError(405, "Método não permitido.");
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new HttpError(403, "Origem da requisição inválida.");
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new HttpError(415, "Envie JSON.");
  const body = await readBoundedJson(request, 4096);
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (path === "auth/logout") {
    const token = readCookie(request, SESSION_COOKIE);
    if (token)
      await db
        .prepare("DELETE FROM auth_sessions WHERE id=?")
        .bind(await sha256(token))
        .run();
    return json({ signedOut: true }, 200, {
      "Set-Cookie": sessionCookie(request, "", 0),
    });
  }
  if (path === "auth/signup") {
    await limited(db, `auth:signup:${ip}`, 3_600_000, 20);
    const data = signupSchema.parse(body);
    const existing = await db
      .prepare("SELECT user_id FROM auth_credentials WHERE email=?")
      .bind(data.email)
      .first();
    if (existing)
      throw new HttpError(
        409,
        "Já existe uma conta com este e-mail. Entre ou use outro e-mail.",
      );
    const userId = `user:${uid()}`,
      now = new Date().toISOString(),
      secret = await hashPassword(data.password),
      session = await startSession(db, request, userId);
    await db.batch([
      db
        .prepare(
          "INSERT INTO users (id,created_at,settings,demo_seeded) VALUES (?,?,?,0)",
        )
        .bind(userId, now, JSON.stringify(DEFAULT_SETTINGS)),
      db
        .prepare("INSERT INTO accounts (user_id,created_at) VALUES (?,?)")
        .bind(userId, now),
      db
        .prepare(
          "INSERT INTO auth_credentials (user_id,email,name,password_hash,password_salt,iterations,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          userId,
          data.email,
          data.name,
          secret.hash,
          secret.salt,
          secret.iterations,
          now,
          now,
        ),
      db
        .prepare(
          "INSERT INTO brick_preferences (user_id,selected_plan,updated_at) VALUES (?,?,?)",
        )
        .bind(userId, data.plan ?? null, now),
      session.statement,
    ]);
    return json(
      { user: { id: userId, name: data.name, email: data.email } },
      201,
      { "Set-Cookie": session.cookie },
    );
  }
  await limited(db, `auth:login:${ip}`, 900_000, 30);
  const data = loginSchema.parse(body);
  await limited(db, `auth:login-email:${data.email}`, 900_000, 10);
  const row = await db
    .prepare(
      "SELECT user_id,name,password_hash,password_salt,iterations FROM auth_credentials WHERE email=?",
    )
    .bind(data.email)
    .first<{
      user_id: string;
      name: string;
      password_hash: string;
      password_salt: string;
      iterations: number;
    }>();
  const valid = await verifyPassword(
    data.password,
    row
      ? {
          hash: row.password_hash,
          salt: row.password_salt,
          iterations: row.iterations,
        }
      : null,
  );
  if (!row || !valid)
    throw new HttpError(401, "E-mail ou senha incorretos.");
  const session = await startSession(db, request, row.user_id);
  await db.batch([
    db
      .prepare("DELETE FROM auth_sessions WHERE user_id=? AND expires_at<=?")
      .bind(row.user_id, new Date().toISOString()),
    session.statement,
  ]);
  return json(
    { user: { id: row.user_id, name: row.name, email: data.email } },
    200,
    { "Set-Cookie": session.cookie },
  );
}
