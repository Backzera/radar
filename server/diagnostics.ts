import { delayStatistics } from "../core/freshness";
import { all, uid, type Database } from "./store";
import {
  ProviderError,
  type MarketplaceProvider,
  type ProviderHealth,
} from "../providers/contract";
import { providerBudgetKey, type PilotConfig } from "./pilot";
export async function checkProvider(
  db: Database,
  userId: string,
  provider: MarketplaceProvider,
) {
  const start = Date.now();
  let result;
  try {
    result = await provider.healthCheck();
  } catch (e) {
    result = {
      ok: false,
      message:
        e instanceof ProviderError
          ? e.message
          : "Falha ao validar o fornecedor",
    };
  }
  if (
    result.ok &&
    (await db
      .prepare(
        "SELECT id FROM provider_health WHERE user_id=? AND provider=? AND kind='collection' AND ok=1 AND volume>0 LIMIT 1",
      )
      .bind(userId, provider.id)
      .first())
  )
    result = {
      ...result,
      message:
        "Configuração validada sem coleta. A coleta real anterior permanece comprovada no histórico.",
    };
  await db
    .prepare(
      "INSERT INTO provider_health (id,user_id,provider,ok,latency_ms,volume,error,checked_at,kind,data) VALUES (?,?,?,?,?,0,?,?,'validation',?)",
    )
    .bind(
      uid(),
      userId,
      provider.id,
      Number(result.ok),
      Date.now() - start,
      result.ok ? null : result.message,
      new Date().toISOString(),
      JSON.stringify(result),
    )
    .run();
  return result;
}
export async function diagnostics(
  db: Database,
  userId: string,
  config: PilotConfig,
) {
  const [runs, health, observations, budget, totals, candidates] =
    await Promise.all([
      all<Record<string, unknown>>(
        db,
        "SELECT * FROM provider_runs WHERE user_id=? AND provider='brightdata' ORDER BY started_at DESC LIMIT 100",
        userId,
      ),
      all<{
        ok: number;
        error: string | null;
        checked_at: string;
        kind: string;
        data: string | null;
        volume: number;
      }>(
        db,
        "SELECT ok,error,checked_at,kind,data,volume FROM provider_health WHERE user_id=? AND provider='brightdata' ORDER BY checked_at DESC LIMIT 100",
        userId,
      ),
      all<{
        query_type: string;
        delay_seconds: number | null;
        baseline: number;
        published_at: string | null;
        publication_status: string;
        first_seen_at: string;
        city: string;
      }>(
        db,
        "SELECT query_type,delay_seconds,baseline,published_at,publication_status,first_seen_at,city FROM discovery_observations WHERE user_id=? AND provider='brightdata' ORDER BY first_seen_at DESC LIMIT 10000",
        userId,
      ),
      db
        .prepare("SELECT count FROM rate_limits WHERE key=?")
        .bind(providerBudgetKey("brightdata"))
        .first<{ count: number }>(),
      db
        .prepare(
          "SELECT COUNT(*) AS observed,SUM(CASE WHEN first_seen_at>=? THEN 1 ELSE 0 END) AS last24h FROM listings WHERE user_id=? AND demo=0",
        )
        .bind(new Date(Date.now() - 86400000).toISOString(), userId)
        .first<{ observed: number; last24h: number }>(),
      all<{
        external_id: string;
        original_url: string;
        first_seen_at: string;
        last_seen_at: string;
        baseline: number;
      }>(
        db,
        "SELECT external_id,original_url,MIN(first_seen_at) AS first_seen_at,MAX(last_seen_at) AS last_seen_at,MAX(baseline) AS baseline FROM discovery_candidates WHERE user_id=? AND provider='brightdata' AND resolved_at IS NULL GROUP BY external_id ORDER BY last_seen_at DESC LIMIT 100",
        userId,
      ),
    ]);
  const validation = health.find((h) => h.kind === "validation");
  const collection = health.find((h) => h.kind === "collection");
  const latest = health[0];
  const verified = health.some(
    (h) => h.kind === "collection" && h.ok && h.volume > 0,
  );
  const methods = ["keyword", "search_url"].map((method) => {
    const obs = observations.filter((o) => o.query_type === method),
      nonBaseline = obs.filter((o) => !o.baseline);
    return {
      method,
      observed: obs.length,
      known: obs.filter((o) => o.published_at).length,
      invalid: obs.filter((o) =>
        ["invalid", "future"].includes(o.publication_status),
      ).length,
      baseline: obs.filter((o) => o.baseline).length,
      localityKnown: obs.filter((o) => o.city).length,
      ...delayStatistics(nonBaseline.map((o) => o.delay_seconds)),
    };
  });
  const sums = (key: string) =>
    runs.reduce((s, r) => s + Number(r[key] ?? 0), 0);
  return {
    pilot: config.pilot,
    maxDailyTriggers: config.maxDailyTriggers,
    maxRecords: config.maxRecords,
    externalAlerts: config.externalAlerts,
    usedToday: budget?.count ?? 0,
    budgetReset: "00:00 UTC",
    status: !latest
      ? "Not validated"
      : !latest.ok || (collection && !collection.ok)
        ? "Error"
        : !verified
          ? validation?.ok
            ? "Configuration valid"
            : "Not validated"
          : (validation?.data &&
                !JSON.parse(validation.data).methods?.search_url) ||
              runs.some((r) => Number(r.rejected) > 0)
            ? "Degraded"
            : "Healthy",
    lastValidation: validation?.checked_at ?? null,
    validation: validation?.data
      ? (JSON.parse(validation.data) as ProviderHealth)
      : null,
    lastSearch: runs[0]?.started_at ?? null,
    lastSuccess:
      health.find((h) => h.ok && h.kind === "collection")?.checked_at ?? null,
    lastError: latest && !latest.ok ? latest.error : null,
    collectionVerified: verified,
    discoveryVerified:
      verified || runs.some((r) => Number(r.candidates_found) > 0),
    candidates,
    observed: totals?.observed ?? 0,
    last24h: totals?.last24h ?? 0,
    received: sums("records_received"),
    accepted: sums("accepted"),
    newListings: sums("new_listings"),
    duplicates: sums("duplicates"),
    rejected: sums("rejected"),
    runs,
    methods,
    coverage: "Ainda não mensurável; sem referência completa do Facebook",
    window:
      "100 execuções e 10.000 primeiras observações por método mais recentes",
  };
}
