import { uid, type Database } from "./store";
import type { Alert, Listing } from "../core/types";
import { publicationWindow, relativePublication } from "../core/selection";
export interface NotificationChannel {
  send(alert: Alert, url: string): Promise<void>;
}
const money = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "Não informado";
/** The provider explicitly rejected the message; no ambiguous transport failure. */
export class DeliveryRejected extends Error {
  constructor(
    public retryable: boolean,
    public retryAfterSeconds = 60,
  ) {
    super("Canal recusou a entrega");
  }
}
export class TelegramChannel implements NotificationChannel {
  constructor(
    private token: string,
    private chatId: string,
  ) {}
  async send(alert: Alert, url: string) {
    if (alert.demo) return;
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: `ÁGIO · RADAR
${alert.title}
Preço: ${money(alert.price)} · seu limite: ${money(alert.maxPurchase)}
Revenda considerada: ${money(alert.expectedSale)}
Margem estimada: ${money(alert.netProfit)}
${relativePublication(alert.publishedAt ?? null)}
${alert.event === "price_drop" ? "O preço caiu desde a última consulta." : "Encontramos um anúncio recente dentro dos seus critérios."}
${alert.availability === "unknown" ? "Disponibilidade não confirmada. Consulte o vendedor." : "A disponibilidade pode mudar. Confira o anúncio."}
Estimativas não são garantia de lucro.
${url}`,
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const result = (await response.json()) as {
      ok?: boolean;
      error_code?: number;
      parameters?: { retry_after?: number };
    };
    if (result.ok === false && typeof result.error_code === "number")
      throw new DeliveryRejected(
        result.error_code === 429,
        Math.min(3600, Math.max(10, result.parameters?.retry_after ?? 60)),
      );
    if (!response.ok || result.ok !== true)
      throw new Error("Entrega não confirmada");
  }
}
export async function deliverOne(
  db: Database,
  userId: string,
  channel: NotificationChannel | null,
) {
  const now = new Date().toISOString();
  // An expired sending lease means delivery may have happened. Never resend blindly.
  await db
    .prepare(
      "UPDATE notification_outbox SET status='uncertain',error='Envio interrompido; entrega incerta, revisão necessária',lease_token=NULL,lease_until=NULL WHERE user_id=? AND status='sending' AND (lease_until IS NULL OR lease_until<?)",
    )
    .bind(userId, now)
    .run();
  if (!channel) return { status: "not_configured" };
  const token = uid();
  const item = await db
    .prepare(
      "UPDATE notification_outbox SET status='sending',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=(SELECT id FROM notification_outbox WHERE user_id=? AND status='pending' AND available_at<=? ORDER BY available_at LIMIT 1) RETURNING *",
    )
    .bind(token, new Date(Date.now() + 30000).toISOString(), userId, now)
    .first<{ id: string; alert_id: string; attempts: number }>();
  if (!item) return { status: "idle" };
  try {
    const record = await db
      .prepare(
        "SELECT a.data,l.url,l.data AS listing_data FROM alerts a JOIN listings l ON l.id=a.listing_id AND l.user_id=a.user_id WHERE a.id=? AND a.user_id=?",
      )
      .bind(item.alert_id, userId)
      .first<{ data: string; url: string; listing_data: string }>();
    if (!record) throw new DeliveryRejected(false);
    const alert: Alert = JSON.parse(record.data);
    if (!alert.demo) {
      const listing: Listing = JSON.parse(record.listing_data);
      const rejected =
        !publicationWindow(listing).valid ||
        ["sold", "removed", "unavailable"].includes(listing.availability);
      if (rejected) {
        await db
          .prepare(
            "UPDATE notification_outbox SET status='failed',error='Aviso não enviado: anúncio fora do período ou indisponível',lease_token=NULL,lease_until=NULL WHERE id=? AND user_id=? AND lease_token=? AND status='sending'",
          )
          .bind(item.id, userId, token)
          .run();
        return { status: "suppressed" };
      }
      await channel.send(
        {
          ...alert,
          availability: listing.availability,
          publishedAt: listing.publishedAt,
        },
        record.url,
      );
    }
    const confirmed = await db
      .prepare(
        "UPDATE notification_outbox SET status='sent',lease_token=NULL,lease_until=NULL WHERE id=? AND user_id=? AND lease_token=? AND status='sending'",
      )
      .bind(item.id, userId, token)
      .run();
    return { status: confirmed.meta.changes ? "sent" : "uncertain" };
  } catch (error) {
    if (error instanceof DeliveryRejected) {
      const retry = error.retryable && item.attempts < 3;
      const changed = await db
        .prepare(
          "UPDATE notification_outbox SET status=?,error=?,available_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND user_id=? AND lease_token=? AND status='sending'",
        )
        .bind(
          retry ? "pending" : "failed",
          retry
            ? "Canal recusou temporariamente; nova tentativa limitada"
            : "Canal recusou entrega; revise configuração",
          new Date(
            Date.now() + error.retryAfterSeconds * 1000 * item.attempts,
          ).toISOString(),
          item.id,
          userId,
          token,
        )
        .run();
      return {
        status: changed.meta.changes
          ? retry
            ? "retry_scheduled"
            : "failed"
          : "uncertain",
      };
    }
    // Telegram does not offer an idempotency key: an ambiguous send must not be blindly retried.
    await db
      .prepare(
        "UPDATE notification_outbox SET status='uncertain',error='Entrega não confirmada; revisar canal antes de repetir',lease_token=NULL,lease_until=NULL WHERE id=? AND user_id=? AND lease_token=? AND status='sending'",
      )
      .bind(item.id, userId, token)
      .run();
    return { status: "uncertain" };
  }
}
