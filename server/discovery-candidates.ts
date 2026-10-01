import type { DiscoveryCandidate } from "../providers/contract";
import { batch, uid, type Database } from "./store";
export async function saveCandidates(
  db: Database,
  userId: string,
  scopeId: string,
  runId: string,
  candidates: DiscoveryCandidate[],
  baseline: boolean,
  now: Date,
) {
  await batch(
    db,
    candidates.map((c) =>
      db
        .prepare(
          "INSERT INTO discovery_candidates (id,user_id,provider,scope_id,external_id,original_url,first_seen_at,last_seen_at,baseline,last_run_id,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,(SELECT last_seen_at FROM listings WHERE user_id=? AND external_id=? AND marketplace=? AND demo=0 LIMIT 1)) ON CONFLICT(user_id,provider,scope_id,external_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,original_url=excluded.original_url,last_run_id=excluded.last_run_id,resolved_at=COALESCE(discovery_candidates.resolved_at,excluded.resolved_at)",
        )
        .bind(
          uid(),
          userId,
          c.provider,
          scopeId,
          c.externalId,
          c.originalUrl,
          now.toISOString(),
          now.toISOString(),
          Number(baseline),
          runId,
          userId,
          c.externalId,
          c.marketplace,
        ),
    ),
  );
}
