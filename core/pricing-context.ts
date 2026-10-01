import type { Listing, Monitor, Settings, Pricing } from "./types";
import { priceAnomalies } from "./normalize";
import { priceListing } from "./pricing";
/** Request-local group context. Never shared across accounts or source versions. */
export function groupPricer(
  pool: Listing[],
  settings: Settings,
  now: Date,
  calibration: number,
) {
  const invalid = new Map(
    pool.map((l) => [l, !!priceAnomalies(l.title, l.description).length]),
  );
  const sellers = new Set<string>(),
    fingerprints = new Set<string>();
  let unique = true;
  for (const l of pool) {
    if (
      (l.sellerId && sellers.has(l.sellerId)) ||
      fingerprints.has(l.fingerprint)
    )
      unique = false;
    if (l.sellerId) sellers.add(l.sellerId);
    fingerprints.add(l.fingerprint);
  }
  const cache = new Map<string, Pricing>();
  return (l: Listing, m?: Monitor) => {
    const config = { ...settings, minRoi: m?.minRoi ?? settings.minRoi };
    // With duplicates, target exclusion changes which offer survives deduplication.
    // In that case always run the exact algorithm, while reusing invariant price checks.
    const key = unique
      ? JSON.stringify([
          l.product.key,
          l.product.condition,
          l.city,
          l.demo,
          l.price,
          l.currency,
          l.availability,
          !!l.sellerId,
          invalid.get(l),
          Date.parse(l.lastSeenAt) >=
            +now - (l.availability === "unknown" ? 7 : 30) * 86400000,
          config.minRoi,
        ])
      : l.id + ":" + config.minRoi;
    const hit = cache.get(key);
    if (hit) return hit;
    const calculated = priceListing(l, pool, config, now, calibration, invalid),
      summary = { ...calculated, comparables: [] };
    cache.set(key, summary);
    return summary;
  };
}
