import { all, type Database } from "./store";
import { customerReason } from "../core/customer-copy";
/** Bounded account-local operational sample. Counts observations, not unique products or billed reais. */
export async function qualitySummary(db: Database, userId: string) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const runs = await all<{
    status: string;
    records_received: number;
    duplicates: number;
    summary: string;
  }>(
    db,
    "SELECT status,records_received,duplicates,summary FROM provider_runs WHERE user_id=? AND started_at>=? ORDER BY started_at DESC LIMIT 100",
    userId,
    since,
  );
  const reasons = new Map<string, number>();
  let received = 0,
    matched = 0,
    withinBudget = 0,
    qualified = 0,
    duplicates = 0;
  const num = (n: unknown) =>
    Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0;
  for (const run of runs) {
    let s: Record<string, unknown> = {};
    try {
      s = JSON.parse(run.summary || "{}");
    } catch {
      /* An invalid historical summary is not proof of usable results. */
    }
    received += num(run.records_received);
    duplicates += num(run.duplicates);
    matched += num(s.matched);
    withinBudget += num(s.withinBudget);
    qualified += num(s.qualified);
    if (s.primaryReasons && typeof s.primaryReasons === "object")
      for (const [r, count] of Object.entries(s.primaryReasons)) {
        const label = customerReason(r).slice(0, 180);
        reasons.set(label, (reasons.get(label) ?? 0) + num(count));
      }
  }
  return {
    since,
    sampleLimit: 100,
    runs: runs.length,
    received,
    matched,
    withinBudget,
    qualified,
    duplicates,
    completed: runs.filter((r) =>
      ["completed", "needs_details"].includes(r.status),
    ).length,
    failed: runs.filter((r) =>
      ["dead", "failed", "uncertain"].includes(r.status),
    ).length,
    usableShare: received
      ? Math.min(100, Math.round((withinBudget / received) * 100))
      : null,
    reasons: [...reasons]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([reason, count]) => ({ reason, count })),
    note: "Últimas 100 execuções desta conta em até sete dias. Contagens são observações e podem repetir anúncios entre buscas. Não representam a fatura da fonte.",
  };
}
export type QualitySummary = Awaited<ReturnType<typeof qualitySummary>>;
