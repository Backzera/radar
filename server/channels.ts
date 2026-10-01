import { z } from "zod";
import { getAccount, recordEvent } from "./accounts";
import { equalSecret, HttpError, type RuntimeConfig } from "./security";
import type { Database } from "./store";
const digest = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
export async function createTelegramLink(
  db: Database,
  userId: string,
  config: RuntimeConfig,
) {
  const account = await getAccount(db, userId);
  if (
    account.status !== "active" ||
    !account.telegram ||
    config.EXTERNAL_ALERTS_ENABLED !== "true"
  )
    throw new HttpError(403, "Telegram não está habilitado para este acesso.");
  if (
    !config.TELEGRAM_BOT_TOKEN ||
    !config.TELEGRAM_WEBHOOK_SECRET ||
    config.TELEGRAM_WEBHOOK_SECRET.length < 32 ||
    !/^\w{5,32}$/.test(config.TELEGRAM_BOT_USERNAME ?? "")
  )
    throw new HttpError(
      503,
      "A administração ainda precisa configurar este canal.",
    );
  const bytes = crypto.getRandomValues(new Uint8Array(32)),
    token = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const expires = new Date(Date.now() + 600000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM channel_tokens WHERE user_id=?").bind(userId),
    db
      .prepare(
        "INSERT INTO channel_tokens(token_hash,user_id,expires_at) VALUES (?,?,?)",
      )
      .bind(await digest(token), userId, expires),
  ]);
  return {
    url: `https://t.me/${config.TELEGRAM_BOT_USERNAME}?start=${token}`,
    expiresAt: expires,
  };
}
const updateSchema = z
  .object({
    message: z
      .object({
        text: z.string().max(256).optional(),
        chat: z.object({ id: z.number().int().safe(), type: z.string() }),
        from: z
          .object({
            id: z.number().int().safe(),
            is_bot: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();
export async function acceptTelegramUpdate(
  db: Database,
  request: Request,
  input: unknown,
  config: RuntimeConfig,
) {
  if (
    !config.TELEGRAM_WEBHOOK_SECRET ||
    config.TELEGRAM_WEBHOOK_SECRET.length < 32 ||
    !(await equalSecret(
      request.headers.get("x-telegram-bot-api-secret-token") ?? "",
      config.TELEGRAM_WEBHOOK_SECRET,
    ))
  )
    throw new HttpError(401, "Canal não autenticado.");
  const update = updateSchema.parse(input),
    message = update.message;
  if (
    !message ||
    message.chat.type !== "private" ||
    message.from?.is_bot ||
    message.from?.id !== message.chat.id
  )
    return { accepted: false };
  const token = message.text?.match(
    /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{43})$/,
  )?.[1];
  if (!token) return { accepted: false };
  const tokenHash = await digest(token),
    now = new Date().toISOString();
  const row = await db
    .prepare(
      "SELECT user_id FROM channel_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?",
    )
    .bind(tokenHash, now)
    .first<{ user_id: string }>();
  if (!row) return { accepted: false };
  const account = await getAccount(db, row.user_id);
  if (
    !account.telegram ||
    account.status !== "active" ||
    config.EXTERNAL_ALERTS_ENABLED !== "true"
  )
    return { accepted: false };
  const address = String(message.chat.id);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO notification_destinations(user_id,channel,address,enabled,verified_at) SELECT user_id,'telegram',?,1,? FROM channel_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>? ON CONFLICT(user_id,channel) DO UPDATE SET address=excluded.address,enabled=1,verified_at=excluded.verified_at`,
        )
        .bind(address, now, tokenHash, now),
      db
        .prepare(
          `UPDATE channel_tokens SET consumed_at=? WHERE token_hash=? AND EXISTS(SELECT 1 FROM notification_destinations d WHERE d.user_id=channel_tokens.user_id AND d.channel='telegram' AND d.address=?)`,
        )
        .bind(now, tokenHash, address),
    ]);
  } catch {
    throw new HttpError(
      409,
      "Este destino não pôde ser vinculado. Desvincule-o da outra conta antes de tentar novamente.",
    );
  }
  await recordEvent(db, row.user_id, "channel_linked");
  return { accepted: true };
}
export async function disconnectTelegram(db: Database, userId: string) {
  await db.batch([
    db
      .prepare(
        "UPDATE notification_destinations SET enabled=0 WHERE user_id=? AND channel='telegram'",
      )
      .bind(userId),
    db.prepare("DELETE FROM channel_tokens WHERE user_id=?").bind(userId),
    db
      .prepare(
        "UPDATE notification_outbox SET status='failed',error='Canal desconectado pelo titular' WHERE user_id=? AND status='pending'",
      )
      .bind(userId),
  ]);
  return { disconnected: true };
}
