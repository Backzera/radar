import { publicationWindow, isWorkingCandidate } from "../core/selection";
import { calibrationFactor } from "../core/trading";
import type {
  Listing,
  RawListing,
  Monitor,
  Alert,
  Settings,
} from "../core/types";
import { analyze, matchesMonitor } from "../core/opportunity";
import { normalize, priceAnomalies } from "../core/normalize";
import { canonicalUrl, fingerprint } from "../core/freshness";
import {
  all,
  getListings,
  getPurchases,
  listingStatement,
  uid,
  type Database,
} from "./store";
function validPrice(raw: RawListing): number | null {
  return raw.price !== null &&
    Number.isFinite(raw.price) &&
    raw.price > 0 &&
    raw.currency === "BRL" &&
    !priceAnomalies(raw.title, raw.description).length
    ? raw.price
    : null;
}
export function materialize(
  raw: RawListing,
  baseline: boolean,
  now: Date,
  existing?: Listing,
): Listing {
  const previousValid = existing
    ? (validPrice(existing) ?? existing.lastValidPrice ?? null)
    : null;
  const currentValid = validPrice(raw);
  const dropped =
    currentValid !== null &&
    previousValid !== null &&
    currentValid < previousValid;
  const increased =
    currentValid !== null &&
    previousValid !== null &&
    currentValid > previousValid;
  const retainPublication =
    !!existing?.publishedAt &&
    (!raw.publishedAt ||
      Date.parse(raw.publishedAt) > Date.parse(existing.publishedAt));
  const publication =
    existing?.publishedAt &&
    (!raw.publishedAt ||
      Date.parse(raw.publishedAt) > Date.parse(existing.publishedAt))
      ? existing.publishedAt
      : raw.publishedAt;
  return {
    ...raw,
    availability:
      raw.availability === "unknown" &&
      existing?.availabilityCheckedAt &&
      existing.availability !== "unknown"
        ? existing.availability
        : raw.availability,
    availabilityCheckedAt:
      raw.availabilityCheckedAt ??
      (raw.availability !== "unknown"
        ? now.toISOString()
        : existing?.availabilityCheckedAt),
    url: canonicalUrl(raw.url),
    id: existing?.id ?? uid(),
    product: normalize(raw),
    firstSeenAt: existing?.firstSeenAt ?? now.toISOString(),
    lastSeenAt: now.toISOString(),
    baseline: existing?.baseline ?? baseline,
    fingerprint: fingerprint([
      raw.title,
      String(raw.price),
      raw.sellerId ?? "",
      ...raw.images.slice(0, 1),
    ]),
    seenBy: [...new Set([...(existing?.seenBy ?? []), raw.provider])],
    lastValidPrice: currentValid ?? previousValid,
    previousPrice: dropped
      ? previousValid
      : increased
        ? null
        : (existing?.previousPrice ?? null),
    priceChangedAt: dropped
      ? now.toISOString()
      : increased
        ? null
        : (existing?.priceChangedAt ?? null),
    // A missing provider date does not erase an already captured publication timestamp.
    publishedAt: publication ?? null,
    publicationStatus: retainPublication
      ? existing?.publicationStatus
      : raw.publicationStatus,
    publicationConfidence:
      !retainPublication && raw.publishedAt
        ? raw.publicationConfidence
        : (existing?.publicationConfidence ?? 0),
    publicationSource:
      !retainPublication && raw.publishedAt
        ? raw.publicationSource
        : (existing?.publicationSource ?? "unknown"),
  };
}
export async function ingest(
  db: Database,
  userId: string,
  monitor: Monitor,
  rawItems: RawListing[],
  baseline: boolean,
  settings: Settings,
  now = new Date(),
  notify = true,
  externalNotify = true,
) {
  const pool = await getListings(
    db,
    userId,
    10000,
    monitor.provider === "brightdata",
  );
  for (let i = 0; i < rawItems.length; i += 40) {
    const chunk = rawItems.slice(i, i + 40),
      placeholders = chunk.map(() => "?").join(",");
    if (!chunk.length) continue;
    const identities = await all<{ data: string }>(
      db,
      `SELECT data FROM listings WHERE user_id=? AND (external_id IN (${placeholders}) OR url IN (${placeholders}))`,
      userId,
      ...chunk.map((r) => r.externalId),
      ...chunk.map((r) => canonicalUrl(r.url)),
    );
    for (const row of identities) {
      const l: Listing = JSON.parse(row.data);
      if (!pool.some((p) => p.id === l.id)) pool.push(l);
    }
  }
  const sightings = await all<{ listing_id: string; baseline: number }>(
    db,
    "SELECT listing_id,baseline FROM monitor_sightings WHERE user_id=? AND monitor_id=? AND provider=? AND revision=?",
    userId,
    monitor.id,
    monitor.provider,
    monitor.revision,
  );
  const byId = new Map(
      pool.map((l) => [`${l.marketplace}:${l.externalId}`, l]),
    ),
    byUrl = new Map(pool.map((l) => [l.url, l]));
  const touched: Listing[] = [],
    changes: D1PreparedStatement[] = [];
  const knownBefore = new Set(pool.map((l) => l.id));
  let discoveries = 0,
    duplicates = 0,
    rejected = 0,
    priceChanges = 0;
  for (const raw of rawItems) {
    const existing =
      byId.get(`${raw.marketplace}:${raw.externalId}`) ??
      byUrl.get(canonicalUrl(raw.url));
    if (existing && existing.demo !== raw.demo) {
      rejected++;
      continue;
    }
    // Recover the reference for older stored records that predate lastValidPrice.
    // A missing current quote stays missing; only the comparison reference is restored.
    if (
      existing &&
      validPrice(existing) === null &&
      existing.lastValidPrice === undefined
    ) {
      const history = await all<{ price: number; data: string }>(
        db,
        "SELECT price,data FROM listing_snapshots WHERE user_id=? AND listing_id=? AND price>0 ORDER BY observed_at DESC,rowid DESC",
        userId,
        existing.id,
      );
      existing.lastValidPrice =
        history.find((snapshot) => {
          const details = JSON.parse(snapshot.data);
          return !priceAnomalies(
            details.title ?? existing.title,
            details.description ?? existing.description,
          ).length;
        })?.price ?? null;
    }
    if (existing) duplicates++;
    if (existing && existing.price !== raw.price) priceChanges++;
    const candidate = raw.demo
      ? null
      : await db
          .prepare(
            "SELECT MIN(first_seen_at) AS first_seen_at,MAX(CASE WHEN scope_id=? THEN baseline ELSE 0 END) AS baseline FROM discovery_candidates WHERE user_id=? AND provider=? AND external_id=?",
          )
          .bind(
            monitor.id + ":" + monitor.provider + ":" + monitor.revision,
            userId,
            raw.provider,
            raw.externalId,
          )
          .first<{ first_seen_at: string | null; baseline: number }>();
    const candidateBaseline = !!candidate?.baseline;
    const l = materialize(raw, baseline || candidateBaseline, now, existing);
    if (candidate?.first_seen_at && candidate.first_seen_at < l.firstSeenAt)
      l.firstSeenAt = candidate.first_seen_at;
    if (candidate?.first_seen_at)
      changes.push(
        db
          .prepare(
            "UPDATE discovery_candidates SET resolved_at=? WHERE user_id=? AND provider=? AND external_id=?",
          )
          .bind(now.toISOString(), userId, raw.provider, raw.externalId),
      );
    if (!existing) {
      discoveries++;
      pool.push(l);
    } else pool[pool.findIndex((x) => x.id === existing.id)] = l;
    byId.set(`${l.marketplace}:${l.externalId}`, l);
    byUrl.set(l.url, l);
    changes.push(listingStatement(db, userId, l));
    if (
      !existing ||
      existing.price !== l.price ||
      existing.availability !== l.availability ||
      existing.title !== l.title ||
      existing.description !== l.description
    )
      changes.push(
        db
          .prepare(
            "INSERT INTO listing_snapshots (id,listing_id,user_id,price,availability,observed_at,hash,data) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            uid(),
            l.id,
            userId,
            l.price,
            l.availability,
            now.toISOString(),
            l.fingerprint,
            JSON.stringify({
              title: l.title,
              description: l.description,
              publishedAt: l.publishedAt,
              provider: l.provider,
            }),
          ),
      );
    changes.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO monitor_sightings (id,user_id,monitor_id,provider,revision,listing_id,baseline,first_seen_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          uid(),
          userId,
          monitor.id,
          raw.provider,
          monitor.revision,
          l.id,
          Number(baseline || candidateBaseline),
          candidate?.first_seen_at ?? now.toISOString(),
        ),
    );
    if (candidateBaseline && !sightings.some((s) => s.listing_id === l.id))
      sightings.push({ listing_id: l.id, baseline: 1 });
    touched.push(l);
  }
  const existingAlerts = await all<{
    event_key: string;
    created_at: string;
    listing_id: string;
  }>(
    db,
    "SELECT event_key,created_at,listing_id FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000",
    userId,
  );
  const purchases = await getPurchases(db, userId, true);
  const alertIndexes: number[] = [];
  const funnel = {
    found: rawItems.length,
    matched: 0,
    withinBudget: 0,
    qualified: 0,
    alertable: 0,
    primaryReasons: {} as Record<string, number>,
  };
  for (const l of touched) {
    const sighting = sightings.find((s) => s.listing_id === l.id);
    const analysis = analyze(
      { ...l, baseline: baseline || l.baseline || !!sighting?.baseline },
      pool,
      settings,
      monitor,
      now,
      calibrationFactor(l, pool, purchases),
    );
    if (matchesMonitor(l, monitor)) funnel.matched++;
    if (analysis.budgetEligible) funnel.withinBudget++;
    if (analysis.eligible) funnel.qualified++;
    if (analysis.notificationEligible) funnel.alertable++;
    if (!analysis.budgetEligible) {
      const reason =
        (!publicationWindow(l, monitor, now).valid
          ? "Publicação fora do prazo ou sem data confirmada"
          : null) ??
        (!isWorkingCandidate(l, monitor)
          ? "Produto para peças ou com defeito importante informado"
          : null) ??
        analysis.matchReasons?.[0]?.evidence ??
        (l.price === null
          ? "Preço não confirmado"
          : l.price > monitor.maxPrice
            ? "Acima do orçamento"
            : (analysis.risks[0] ?? "Revisão necessária"));
      funnel.primaryReasons[reason] = (funnel.primaryReasons[reason] ?? 0) + 1;
    }
    changes.push(
      db
        .prepare(
          "INSERT INTO opportunities (id,user_id,listing_id,monitor_id,score,data,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,listing_id,monitor_id) DO UPDATE SET score=excluded.score,data=excluded.data,updated_at=excluded.updated_at",
        )
        .bind(
          uid(),
          userId,
          l.id,
          monitor.id,
          analysis.score,
          JSON.stringify({
            ...analysis,
            pricing: { ...analysis.pricing, comparables: [] },
          }),
          now.toISOString(),
        ),
    );
    if (
      l.demo ||
      baseline ||
      (analysis.event === "new" && knownBefore.has(l.id)) ||
      !(analysis.notificationEligible ?? analysis.eligible) ||
      !notify ||
      (analysis.event === "new" && monitor.notifyNew === false) ||
      (analysis.event === "price_drop" && monitor.notifyDrops === false) ||
      !matchesMonitor(l, monitor)
    )
      continue;
    const key = `${l.id}:${analysis.event === "price_drop" ? `drop:${l.price}:${l.priceChangedAt}` : "new"}`;
    if (
      existingAlerts.some(
        (a) =>
          a.event_key === key ||
          (a.listing_id === l.id &&
            now.getTime() - Date.parse(a.created_at) <
              settings.cooldownMinutes * 60000),
      )
    )
      continue;
    const alert: Alert = {
      id: uid(),
      listingId: l.id,
      title: l.product.model ?? l.title,
      createdAt: now.toISOString(),
      score: analysis.score,
      event: analysis.ultra ? "ultra" : analysis.event,
      priority: analysis.ultra
        ? "ultra"
        : analysis.priceTier === "strong" || analysis.priceTier === "ultra"
          ? "strong"
          : "standard",
      read: false,
      demo: l.demo,
      availability: l.availability,
      confidence: analysis.quality,
      price: l.price,
      maxPurchase: monitor.maxPrice,
      expectedSale: analysis.pricing.quickSale,
      netProfit: analysis.netProfit,
      roi: analysis.roi,
      publishedAt: l.publishedAt,
    };
    const transaction = [
      db
        .prepare(
          "INSERT OR IGNORE INTO alerts (id,user_id,listing_id,event_key,created_at,data,read) VALUES (?,?,?,?,?,?,0)",
        )
        .bind(
          alert.id,
          userId,
          l.id,
          key,
          alert.createdAt,
          JSON.stringify(alert),
        ),
    ];
    if (!l.demo && externalNotify)
      transaction.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO notification_outbox (id,user_id,alert_id,channel,status,attempts,available_at) SELECT ?,user_id,id,'telegram','pending',0,? FROM alerts WHERE user_id=? AND event_key=?",
          )
          .bind(uid(), now.toISOString(), userId, key),
      );
    alertIndexes.push(changes.length);
    changes.push(...transaction);
    existingAlerts.push({
      event_key: key,
      listing_id: l.id,
      created_at: now.toISOString(),
    });
  }
  // One D1 transaction: a failure cannot leave sightings committed without their
  // opportunity/alert. Splitting this batch would make retries lose new events.
  const committed = changes.length ? await db.batch(changes) : [];
  const alertCount = alertIndexes.filter(
    (i) => committed[i].meta.changes,
  ).length;
  return {
    funnel,
    discoveries,
    analyzed: touched.length,
    alerts: alertCount,
    duplicates,
    rejected,
    priceChanges,
  };
}
