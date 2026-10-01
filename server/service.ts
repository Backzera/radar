import { listingAnalysis } from "./evaluation";
import { cents } from "../core/pricing";
import { calibrationFactor } from "../core/trading";
import { financialStorage } from "../core/purchase-policy";
import { analyze, matchesMonitor } from "../core/opportunity";
import { discoveryDelays } from "../core/freshness";
import type { Listing, Monitor, Opportunity, Purchase } from "../core/types";
import {
  all,
  getAlerts,
  getListings,
  getMonitors,
  getPurchases,
  getSettings,
  uid,
  type Database,
} from "./store";
import { ensureUser } from "./seed";
import { feedbackSchema, monitorSchema, settingsSchema } from "./validation";
export async function state(db: Database, userId: string, q = "") {
  await ensureUser(db, userId);
  const [pool, monitors, settings, alerts, purchases, health, jobs, queries] =
    await Promise.all([
      getListings(db, userId, 10000, true),
      getMonitors(db, userId).then((ms) =>
        ms.filter((m) => m.provider === "brightdata"),
      ),
      getSettings(db, userId),
      getAlerts(db, userId, true),
      getPurchases(db, userId, true),
      all<Record<string, unknown>>(
        db,
        "SELECT provider,ok,latency_ms,volume,error,checked_at FROM provider_health WHERE user_id=? AND provider='brightdata' ORDER BY checked_at DESC LIMIT 60",
        userId,
      ),
      all<Record<string, unknown>>(
        db,
        "SELECT id,monitor_id,status,attempts,error,available_at,created_at,json_extract(payload,'$.cursor') AS snapshot_id FROM jobs WHERE user_id=? AND scope_id IN (SELECT id FROM monitor_scopes WHERE provider='brightdata') ORDER BY created_at DESC LIMIT 30",
        userId,
      ),
      all<Record<string, unknown>>(
        db,
        "SELECT monitor_id,query,runs,discoveries FROM search_queries WHERE user_id=? AND monitor_id NOT IN (SELECT id FROM monitors WHERE json_extract(config,'$.provider')='demo')",
        userId,
      ),
    ]);
  let visible = pool;
  if (q)
    visible = (
      await all<{ data: string }>(
        db,
        "SELECT data FROM listings WHERE user_id=? AND demo=0 AND (json_extract(data,'$.title') LIKE ? ESCAPE '!' OR json_extract(data,'$.description') LIKE ? ESCAPE '!') ORDER BY last_seen_at DESC LIMIT 200",
        userId,
        `%${q.replace(/[!%_]/g, "!$&")}%`,
        `%${q.replace(/[!%_]/g, "!$&")}%`,
      )
    ).map((x) => JSON.parse(x.data));
  const sightings = await all<{
    monitor_id: string;
    listing_id: string;
    provider: string;
    revision: number;
    baseline: number;
  }>(
    db,
    "SELECT monitor_id,listing_id,provider,revision,baseline FROM monitor_sightings WHERE user_id=?",
    userId,
  );
  const result: Opportunity[] = visible
    .map((l) => {
      const comparablePool = pool.filter(
        (b) => b.product.key === l.product.key && b.demo === l.demo,
      );
      const relevant = monitors.filter(
        (m) =>
          m.active &&
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
          comparablePool,
          settings,
          m,
          new Date(),
          factor,
        ),
      );
      const analysis =
        assessments.sort(
          (a, b) =>
            Number(b.eligible) - Number(a.eligible) || b.score - a.score,
        )[0] ??
        analyze(l, comparablePool, settings, undefined, new Date(), factor);
      if (!relevant.length) {
        analysis.eligible = false;
        analysis.ultra = false;
        analysis.blocked.push("Nenhum monitor ativo corresponde ao anúncio");
      }
      return { listing: l, analysis };
    })
    .sort(
      (a, b) =>
        Number(b.analysis.eligible) - Number(a.analysis.eligible) ||
        Number(b.analysis.freshness === "just_published") -
          Number(a.analysis.freshness === "just_published") ||
        b.analysis.score - a.analysis.score,
    );
  const totals = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM listings WHERE user_id=? AND demo=0",
    )
    .bind(userId)
    .first<{ count: number }>();
  const alertTotals = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM alerts WHERE user_id=? AND listing_id IN (SELECT id FROM listings WHERE demo=0) AND date(created_at,'-3 hours')=date('now','-3 hours')",
    )
    .bind(userId)
    .first<{ n: number }>();
  const history: Record<string, { initialPrice: number | null }> = {};
  const initialPrices = await all<{ listing_id: string; price: number | null }>(
    db,
    "SELECT listing_id,price FROM (SELECT listing_id,price,ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY observed_at,id) AS rank FROM listing_snapshots WHERE user_id=? AND listing_id IN (SELECT id FROM listings WHERE demo=0)) WHERE rank=1",
    userId,
  );
  for (const row of initialPrices)
    history[row.listing_id] = { initialPrice: row.price };
  const monitorStats: Record<
    string,
    {
      lastRun: string | null;
      nextRun: string | null;
      observed: number;
      opportunities: number;
    }
  > = {};
  for (const m of monitors) {
    const latest = await db
      .prepare(
        "SELECT MAX(completed_at) AS last_run FROM provider_runs WHERE user_id=? AND monitor_id=? AND provider='brightdata'",
      )
      .bind(userId, m.id)
      .first<{ last_run: string | null }>();
    const scope = await db
      .prepare(
        "SELECT next_run_at FROM monitor_scopes WHERE user_id=? AND monitor_id=? AND revision=?",
      )
      .bind(userId, m.id, m.revision)
      .first<{ next_run_at: string }>();
    const observed = await db
      .prepare(
        "SELECT COUNT(DISTINCT listing_id) AS n FROM monitor_sightings WHERE user_id=? AND monitor_id=? AND listing_id IN (SELECT id FROM listings WHERE demo=0)",
      )
      .bind(userId, m.id)
      .first<{ n: number }>();
    monitorStats[m.id] = {
      lastRun: latest?.last_run ?? null,
      nextRun: scope?.next_run_at ?? null,
      observed: observed?.n ?? 0,
      opportunities: result.filter(
        (o) => o.analysis.monitorId === m.id && o.analysis.eligible,
      ).length,
    };
  }
  return {
    history,
    alertsToday: alertTotals?.n ?? 0,
    monitorStats,
    opportunities: result.map((o) => ({
      ...o,
      analysis: {
        ...o.analysis,
        pricing: { ...o.analysis.pricing, comparables: [] },
      },
    })),
    monitors,
    settings,
    alerts,
    purchases,
    health,
    jobs,
    queries,
    delays: discoveryDelays(pool.filter((l) => !l.demo)),
    realMode: true,
    totalListings: totals?.count ?? 0,
    returnedListings: result.length,
    userId,
    now: new Date().toISOString(),
  };
}
export async function saveMonitor(
  db: Database,
  userId: string,
  input: unknown,
  id?: string,
) {
  const previous = id
    ? (await getMonitors(db, userId)).find((m) => m.id === id)
    : undefined;
  if (id && !previous) throw new Error("NOT_FOUND");
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("INVALID_INPUT");
  const incoming = { ...input } as Record<string, unknown>;
  const expectedVersion = incoming.expectedVersion ?? incoming.version;
  delete incoming.expectedVersion;
  delete incoming.version;
  if (
    previous &&
    expectedVersion !== undefined &&
    expectedVersion !== (previous.version ?? 0)
  )
    throw new Error("CONFLICT");
  const inherited = previous
    ? ({ ...previous } as Record<string, unknown>)
    : {};
  for (const key of ["id", "revision", "version"]) delete inherited[key];
  const config = monitorSchema.parse({ ...inherited, ...incoming });
  const monitor: Monitor = {
    ...config,
    version: (previous?.version ?? 0) + 1,
    id: previous?.id ?? uid(),
    revision:
      previous &&
      JSON.stringify([
        previous.product,
        previous.maxListingAgeMinutes,
        previous.city,
        previous.radiusKm,
        previous.query,
        previous.queryType,
        previous.searchUrl,
        previous.providerFilters,
        previous.aliases,
        previous.provider,
      ]) ===
        JSON.stringify([
          config.product,
          config.maxListingAgeMinutes,
          config.city,
          config.radiusKm,
          config.query,
          config.queryType,
          config.searchUrl,
          config.providerFilters,
          config.aliases,
          config.provider,
        ])
        ? previous.revision
        : (previous?.revision ?? 0) + 1,
  };
  if (previous) {
    const changed = await db
      .prepare(
        "UPDATE monitors SET config=?,active=?,financials=? WHERE id=? AND user_id=? AND COALESCE(json_extract(config,'$.version'),0)=?",
      )
      .bind(
        JSON.stringify(monitor),
        Number(monitor.active),
        financialStorage(monitor),
        monitor.id,
        userId,
        previous.version ?? 0,
      )
      .run();
    if (!changed.meta.changes) throw new Error("CONFLICT");
  } else {
    await db
      .prepare(
        "INSERT INTO monitors (id,user_id,config,active,created_at,financials) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        monitor.id,
        userId,
        JSON.stringify(monitor),
        Number(monitor.active),
        new Date().toISOString(),
        financialStorage(monitor),
      )
      .run();
  }
  return monitor;
}
export async function saveSettings(
  db: Database,
  userId: string,
  input: unknown,
) {
  const settings = settingsSchema.parse(input);
  await db
    .prepare("UPDATE users SET settings=? WHERE id=?")
    .bind(JSON.stringify(settings), userId)
    .run();
  return settings;
}
export async function saveFeedback(
  db: Database,
  userId: string,
  input: unknown,
) {
  const f = feedbackSchema.parse(input);
  const row = await db
    .prepare("SELECT data FROM listings WHERE id=? AND user_id=? AND demo=0")
    .bind(f.listingId, userId)
    .first<{ data: string }>();
  if (!row) throw new Error("NOT_FOUND");
  const listing: Listing = JSON.parse(row.data),
    now = new Date().toISOString();
  const statements = [
    db
      .prepare(
        "INSERT INTO feedback (id,user_id,listing_id,type,note,created_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(uid(), userId, f.listingId, f.type, f.note ?? null, now),
  ];
  if (f.type === "bought") {
    if (f.paid === undefined) throw new Error("Preço pago obrigatório");
    const analysis = (await listingAnalysis(db, userId, listing.id)).analysis;
    if (f.boughtAt && Date.parse(f.boughtAt) > Date.now())
      throw new Error("Data de compra futura");
    const purchase: Purchase = {
      id: uid(),
      listingId: listing.id,
      title: listing.product.model ?? listing.title,
      paid: f.paid,
      costs: f.costs ?? 0,
      boughtAt: f.boughtAt ?? now,
      advertisedPrice: listing.price,
      estimatedProfit:
        analysis.pricing.quickSale === null
          ? null
          : (cents(analysis.pricing.quickSale) -
              cents(f.paid) -
              cents(f.costs ?? 0)) /
            100,
      note: f.note ?? "",
      saleFees: 0,
      additionalCosts: 0,
      soldFor: null,
      soldAt: null,
      estimated: analysis.pricing.quickSale,
      estimateSource: analysis.pricing.source,
      automaticBaseEstimate: analysis.pricing.automaticBase ?? null,
    };
    statements.push(
      db
        .prepare(
          "INSERT INTO purchases (id,user_id,listing_id,data) VALUES (?,?,?,?) ON CONFLICT(user_id,listing_id) DO NOTHING",
        )
        .bind(purchase.id, userId, listing.id, JSON.stringify(purchase)),
    );
  }
  if (f.type === "sold") {
    const purchase = (await getPurchases(db, userId)).find(
      (p) => p.listingId === listing.id,
    );
    if (!purchase || f.soldFor === undefined)
      throw new Error("Registre a compra e o preço de venda primeiro");
    const soldAt = f.soldAt ?? now;
    if (soldAt < purchase.boughtAt || Date.parse(soldAt) > Date.now())
      throw new Error("Data da venda deve estar entre a compra e agora");
    const updated = {
      ...purchase,
      soldFor: f.soldFor,
      soldAt,
      costs: f.costs ?? purchase.costs,
      saleFees: f.saleFees ?? purchase.saleFees ?? 0,
      additionalCosts: f.additionalCosts ?? purchase.additionalCosts ?? 0,
    };
    statements.push(
      db
        .prepare("UPDATE purchases SET data=? WHERE id=? AND user_id=?")
        .bind(JSON.stringify(updated), purchase.id, userId),
    );
  }
  if (f.type === "bought" || f.type === "sold")
    statements.push(
      db
        .prepare(
          "INSERT INTO deal_pipeline(user_id,listing_id,stage,note,created_at,updated_at) SELECT ?,?,CASE WHEN json_extract(data,'$.soldAt') IS NOT NULL THEN 'sold' ELSE 'bought' END,?,?,? FROM purchases WHERE user_id=? AND listing_id=? ON CONFLICT(user_id,listing_id) DO UPDATE SET stage=excluded.stage,note=excluded.note,version=deal_pipeline.version+1,updated_at=excluded.updated_at",
        )
        .bind(userId, listing.id, f.note ?? "", now, now, userId, listing.id),
    );
  await db.batch(statements);
  return { saved: true };
}
