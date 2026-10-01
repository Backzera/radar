import { all, getMonitors, type Database } from "./store";
import { enqueueActivation } from "./worker";
/** Intenção durável de primeira busca: o job tem ID fixo, inclusive após reinício. */
export async function processActivations(db: Database, userId: string) {
  const rows = await all<{ id: string; monitor_id: string; revision: number }>(
    db,
    "SELECT id,monitor_id,revision FROM radar_activations WHERE user_id=? AND state='pending' ORDER BY created_at LIMIT 3",
    userId,
  );
  const monitors = await getMonitors(db, userId);
  let queued = 0;
  for (const row of rows) {
    const m = monitors.find((m) => m.id === row.monitor_id),
      now = new Date().toISOString();
    if (!m || !m.active || m.archived || m.revision !== row.revision) {
      await db
        .prepare(
          "UPDATE radar_activations SET state='cancelled',updated_at=? WHERE id=? AND user_id=?",
        )
        .bind(now, row.id, userId)
        .run();
      continue;
    }
    try {
      let jobId = "activation:" + row.id;
      const existing = await db
        .prepare("SELECT id FROM jobs WHERE id=? AND user_id=?")
        .bind(jobId, userId)
        .first();
      if (!existing) {
        const pending = await db
          .prepare(
            "SELECT id FROM jobs WHERE user_id=? AND scope_id=? AND status IN ('pending','running') ORDER BY created_at LIMIT 1",
          )
          .bind(userId, `${m.id}:${m.provider}:${m.revision}`)
          .first<{ id: string }>();
        if (pending) jobId = pending.id;
        else queued += await enqueueActivation(db, userId, m, jobId);
      }
      const job = await db
        .prepare("SELECT id FROM jobs WHERE id=? AND user_id=?")
        .bind(jobId, userId)
        .first();
      if (job)
        await db
          .prepare(
            "UPDATE radar_activations SET state='queued',job_id=?,updated_at=? WHERE id=? AND user_id=? AND state='pending'",
          )
          .bind(jobId, now, row.id, userId)
          .run();
    } catch {
      await db
        .prepare(
          "UPDATE radar_activations SET state='attention',message='Uma execução anterior precisa ser conferida antes de repetir.',updated_at=? WHERE id=? AND user_id=?",
        )
        .bind(now, row.id, userId)
        .run();
    }
  }
  return queued;
}
