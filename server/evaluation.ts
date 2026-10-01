import type {
  Listing,
  Monitor,
  Opportunity,
  Purchase,
  Settings,
  Pricing,
  Analysis,
} from "../core/types";
import { normalize } from "../core/normalize";
import { analyze, matchesMonitor, monitorMismatch } from "../core/opportunity";
import { calibrationFactor } from "../core/trading";
import {
  all,
  getMonitors,
  getPurchases,
  getSettings,
  type Database,
} from "./store";
export interface Sighting {
  monitor_id: string;
  listing_id: string;
  provider: string;
  revision: number;
  baseline: number;
}
export function currentListing(l: Listing): Listing {
  return { ...l, product: normalize(l) };
}
export function evaluate(
  l: Listing,
  pool: Listing[],
  monitors: Monitor[],
  sightings: Sighting[],
  settings: Settings,
  purchases: Purchase[],
  now = new Date(),
  pricing?: (listing: Listing, monitor?: Monitor) => Pricing,
): Opportunity & { assessments: Analysis[] } {
  const relevant = monitors.filter(
    (m) =>
      m.active &&
      !m.archived &&
      m.provider === l.provider &&
      matchesMonitor(l, m) &&
      (m.queryType !== "search_url" ||
        sightings.some(
          (s) =>
            s.monitor_id === m.id &&
            s.revision === m.revision &&
            s.listing_id === l.id,
        )),
  );
  const factor = calibrationFactor(l, pool, purchases);
  const assessments = relevant.map((m) =>
    analyze(
      {
        ...l,
        baseline:
          l.baseline ||
          !!sightings.find(
            (s) =>
              s.monitor_id === m.id &&
              s.revision === m.revision &&
              s.provider === m.provider &&
              s.listing_id === l.id,
          )?.baseline,
      },
      pool,
      settings,
      m,
      now,
      factor,
      pricing?.(l, m),
    ),
  );
  const analysis =
    assessments.sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        Number(b.budgetEligible) - Number(a.budgetEligible) ||
        b.score - a.score,
    )[0] ?? analyze(l, pool, settings, undefined, now, factor, pricing?.(l));
  if (!relevant.length) {
    analysis.eligible = false;
    analysis.ultra = false;
    analysis.budgetEligible = false;
    analysis.notificationEligible = false;
    analysis.classification = "needs_review";
    analysis.matchReasons = monitors
      .filter((m) => m.active && !m.archived && m.provider === l.provider)
      .flatMap((m) => monitorMismatch(l, m));
    analysis.blocked.push("Nenhuma busca ativa corresponde ao anúncio");
  }
  return { listing: l, analysis, assessments };
}
export async function listingAnalysis(
  db: Database,
  userId: string,
  id: string,
) {
  const row = await db
    .prepare("SELECT data FROM listings WHERE id=? AND user_id=? AND demo=0")
    .bind(id, userId)
    .first<{ data: string }>();
  if (!row) throw new Error("NOT_FOUND");
  const l = currentListing(JSON.parse(row.data));
  // Existing normalized keys may predate a catalog change. Re-evaluate in memory, never rewrite originals.
  const [raw, monitors, sightings, settings, purchases] = await Promise.all([
    all<{ data: string }>(
      db,
      "SELECT data FROM listings WHERE user_id=? AND demo=0 ORDER BY last_seen_at DESC,id",
      userId,
    ),
    getMonitors(db, userId),
    all<Sighting>(
      db,
      "SELECT monitor_id,listing_id,provider,revision,baseline FROM monitor_sightings WHERE user_id=? AND listing_id=?",
      userId,
      id,
    ),
    getSettings(db, userId),
    getPurchases(db, userId, true),
  ]);
  const pool = raw
    .map((r) => currentListing(JSON.parse(r.data)))
    .filter((b) => b.product.key === l.product.key);
  return evaluate(l, pool, monitors, sightings, settings, purchases);
}
