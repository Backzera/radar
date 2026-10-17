import { type Database, all, uid } from "./store";
import { getAccount } from "./accounts";
import { plannedInterval } from "../core/service-schedule";
import { UNLIMITED_DAILY_TRIGGERS } from "../core/limits";
import { runAvailabilityCheck, queueSelectiveCheck } from "./availability";
import { processActivations } from "./activations";
import { sharedContract } from "./bootstrap";
import { enqueue, runOne } from "./worker";
import { safeDiagnosticText } from "../core/run-diagnostics";
import { deliverOne, TelegramChannel } from "./notifications";
import type { MarketplaceProvider } from "../providers/contract";
import type { PilotConfig } from "./pilot";
import type { RuntimeConfig } from "./security";
export async function runSchedulerTick(
  db: Database,
  factory: (id: string) => MarketplaceProvider,
  pilot: PilotConfig,
  config: RuntimeConfig,
) {
  const now = new Date().toISOString(),
    token = uid();
  await db
    .prepare(
      "INSERT OR IGNORE INTO worker_heartbeats(id,seen_at,status) VALUES ('scheduler',?,'starting')",
    )
    .bind(now)
    .run();
  const lock = await db
    .prepare(
      "UPDATE worker_heartbeats SET lease_token=?,lease_until=?,seen_at=?,status='running' WHERE id='scheduler' AND (lease_until IS NULL OR lease_until<?)",
    )
    .bind(token, new Date(Date.now() + 120000).toISOString(), now, now)
    .run();
  if (!lock.meta.changes) return { status: "busy", queued: 0 };
  let queued = 0;
  const results = [];
  try {
    const accounts = await all<{ user_id: string }>(
      db,
      `SELECT a.user_id FROM accounts a WHERE
      (a.status='active' AND EXISTS (SELECT 1 FROM monitors m WHERE m.user_id=a.user_id AND m.active=1)) OR
      EXISTS (SELECT 1 FROM notification_outbox n WHERE n.user_id=a.user_id AND n.status IN ('pending','sending')) OR
      EXISTS (SELECT 1 FROM jobs j WHERE j.user_id=a.user_id AND j.status IN ('pending','running') AND json_extract(j.payload,'$.cursor') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM availability_checks c WHERE c.user_id=a.user_id AND c.status IN ('pending','running'))
      ORDER BY a.last_scheduled_at,a.user_id LIMIT 2`,
    );
    for (const row of accounts) {
      const owned = await db
        .prepare(
          "UPDATE worker_heartbeats SET lease_until=? WHERE id='scheduler' AND lease_token=? AND lease_until>?",
        )
        .bind(
          new Date(Date.now() + 120000).toISOString(),
          token,
          new Date().toISOString(),
        )
        .run();
      if (!owned.meta.changes) break;
      const a = await getAccount(db, row.user_id);
      const mine = await db
        .prepare(
          "SELECT COUNT(*) n FROM monitors WHERE user_id=? AND active=1 AND COALESCE(json_extract(config,'$.archived'),0)=0",
        )
        .bind(row.user_id)
        .first<{ n: number }>();
      const total = await db
        .prepare(
          "SELECT COUNT(*) n FROM monitors m JOIN accounts a ON a.user_id=m.user_id WHERE m.active=1 AND a.status='active' AND COALESCE(json_extract(m.config,'$.archived'),0)=0",
        )
        .first<{ n: number }>();
      await db
        .prepare("UPDATE accounts SET last_scheduled_at=? WHERE user_id=?")
        .bind(new Date().toISOString(), row.user_id)
        .run();
      const destination = await db
        .prepare(
          "SELECT address FROM notification_destinations WHERE user_id=? AND channel='telegram' AND enabled=1",
        )
        .bind(row.user_id)
        .first<{ address: string }>();
      const external =
        pilot.externalAlerts &&
        a.status === "active" &&
        !!a.telegram &&
        !!destination &&
        !!config.TELEGRAM_BOT_TOKEN;
      if (config.COLLECTION_ENABLED === "true" && a.status === "active") {
        if (await sharedContract(db))
          queued += await processActivations(db, row.user_id);
        queued += await enqueue(db, row.user_id, false, { pilot: pilot.pilot });
      }
      // Without collection permission only previously paid snapshots may be completed.
      const result = await runOne(db, row.user_id, factory, {
        ...pilot,
        externalAlerts: external,
        // Uso ilimitado: sem teto diário de buscas por conta.
        tenantMaxDailyTriggers: UNLIMITED_DAILY_TRIGGERS,
        minInterval: plannedInterval(
          a.min_interval,
          a.min_interval,
          a.daily_triggers,
          mine?.n ?? 1,
          pilot.maxDailyTriggers,
          total?.n ?? 1,
        ),
        collectionEnabled:
          config.COLLECTION_ENABLED === "true" && a.status === "active",
      });
      await queueSelectiveCheck(db, row.user_id, config);
      const verification = await runAvailabilityCheck(
        db,
        row.user_id,
        factory,
        config,
      );
      const delivery = await deliverOne(
        db,
        row.user_id,
        external
          ? new TelegramChannel(
              config.TELEGRAM_BOT_TOKEN!,
              destination!.address,
            )
          : null,
      );
      results.push({
        userId: row.user_id,
        status: result.status,
        jobId: "jobId" in result ? result.jobId : null,
        snapshotId: "snapshotId" in result ? result.snapshotId : null,
        received: "received" in result ? result.received : null,
        error:
          "error" in result
            ? safeDiagnosticText(
                result.error,
                Object.values(config).filter(
                  (v): v is string => !!v && v.length >= 16,
                ),
              )
            : null,
        phase: "phase" in result ? result.phase : null,
        code: "code" in result ? result.code : null,
        retrySeconds: "retrySeconds" in result ? result.retrySeconds : null,
        delivery: delivery.status,
        verification: verification.status,
      });
    }
    return {
      status:
        queued ||
        results.some(
          (r) => r.jobId || !["idle", "disabled"].includes(r.delivery),
        )
          ? "processed"
          : "idle",
      queued,
      accounts: results.length,
      results,
    };
  } finally {
    await db
      .prepare(
        "UPDATE worker_heartbeats SET seen_at=?,status='idle',lease_token=NULL,lease_until=NULL WHERE id='scheduler' AND lease_token=?",
      )
      .bind(new Date().toISOString(), token)
      .run();
  }
}
