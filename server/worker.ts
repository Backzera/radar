import { confirmedHealth } from "../providers/input-confirmation";
import { readInputConfirmation } from "./input-confirmation";
import { reserveAccountBudget, refundAccountBudget } from "./accounts";
import { saveCandidates } from "./discovery-candidates";
import { expandQueries } from "../core/normalize";
import { nextInterval, retryDelay, selectQueries } from "../core/scheduler";
import { providerQuery, type ProviderQuery } from "../core/provider-query";
import { discoveryDelay } from "../core/freshness";
import type { Monitor, Listing } from "../core/types";
import { ProviderError, type MarketplaceProvider } from "../providers/contract";
import { ingest } from "./ingestion";
import {
  nativePublicationPolicy,
  nativeRadius,
  nativeFilterError,
} from "../providers/search-policy";
import { withKeywordCity } from "../providers/brightdata-schema";
import {
  all,
  batch,
  getMonitors,
  getSettings,
  uid,
  type Database,
} from "./store";
import { providerBudgetKey, type PilotConfig } from "./pilot";
import { monitorSchema } from "./validation";
import { jobLease, LeaseLost } from "./job-lease";
export interface Job {
  id: string;
  user_id: string;
  monitor_id: string;
  scope_id: string;
  status: string;
  attempts: number;
  payload: string;
  lease_token: string;
  created_at: string;
}
interface Payload {
  cursor?: string;
  query?: string;
  polls?: number;
  triggerStarted?: boolean;
  startedAt?: string;
  kind?: "test";
  monitor?: Monitor;
  limit?: number;
  providerQuery?: ProviderQuery;
}
interface Options {
  pilot?: boolean;
  monitorId?: string;
  provider?: string;
  one?: boolean;
}
const defaults: PilotConfig = {
  pilot: true,
  maxDailyTriggers: 5,
  maxRecords: 10,
  externalAlerts: false,
};
async function enqueueMonitor(
  db: Database,
  userId: string,
  m: Monitor,
  force: boolean,
  payload: Payload = {},
  fixedJobId?: string,
) {
  const scopeId = `${m.id}:${m.provider}:${m.revision}`,
    now = new Date().toISOString();
  await db
    .prepare(
      "INSERT OR IGNORE INTO monitor_scopes (id,user_id,monitor_id,provider,revision,baseline_complete,next_run_at,sequence) VALUES (?,?,?,?,?,0,?,0)",
    )
    .bind(scopeId, userId, m.id, m.provider, m.revision, now)
    .run();
  const scope = await db
    .prepare(
      "SELECT next_run_at,failures FROM monitor_scopes WHERE id=? AND user_id=?",
    )
    .bind(scopeId, userId)
    .first<{ next_run_at: string; failures: number }>();
  if (
    !scope ||
    (!force && scope.next_run_at > now) ||
    (scope.failures >= 5 && scope.next_run_at > now)
  )
    return 0;
  const uncertain = await db
    .prepare(
      "SELECT id FROM jobs WHERE scope_id=? AND user_id=? AND status='dead' AND json_extract(payload,'$.triggerStarted')=1 AND json_extract(payload,'$.cursor') IS NULL LIMIT 1",
    )
    .bind(scopeId, userId)
    .first<{ id: string }>();
  if (uncertain)
    throw new ProviderError(
      "Disparo anterior sem confirmação neste monitor/teste. Confira a Bright Data e reconcilie a execução antes de repetir.",
      false,
    );
  const r = await db
    .prepare(
      "INSERT OR IGNORE INTO jobs (id,user_id,monitor_id,scope_id,status,priority,attempts,available_at,payload,created_at) SELECT ?,?,?,?,'pending',?,0,?,?,? WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE scope_id=? AND status IN ('pending','running'))",
    )
    .bind(
      fixedJobId ?? uid(),
      userId,
      m.id,
      scopeId,
      payload.kind ? 20 : m.mode === "manual" ? 10 : 0,
      now,
      JSON.stringify({ ...payload, monitor: m }),
      now,
      scopeId,
    )
    .run();
  return r.meta.changes;
}
export async function enqueueActivation(
  db: Database,
  userId: string,
  m: Monitor,
  jobId: string,
) {
  return enqueueMonitor(db, userId, m, true, {}, jobId);
}
export async function enqueue(
  db: Database,
  userId: string,
  force = false,
  options: Options = {},
) {
  let monitors = (await getMonitors(db, userId)).filter(
    (m) =>
      m.provider === "brightdata" &&
      m.active &&
      !m.archived &&
      (!options.monitorId || m.id === options.monitorId) &&
      (!options.provider || m.provider === options.provider) &&
      (force || !options.pilot),
  );
  if (options.one) monitors = monitors.slice(0, 1);
  let queued = 0;
  for (const m of monitors)
    queued += await enqueueMonitor(db, userId, m, force);
  return queued;
}
export async function enqueueTest(
  db: Database,
  userId: string,
  q: ProviderQuery,
  limit: number,
  config: PilotConfig,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > config.maxRecords)
    throw new ProviderError(
      `Use de 1 a ${config.maxRecords} registros no teste`,
      false,
    );
  // Preserve legacy identities without filters; schema refresh cannot bypass dedup.
  const canonicalQuery = providerQuery(
    q.type === "keyword" ? q.keyword : "",
    q.type,
    q.type === "search_url" ? q.url : null,
    q.filters,
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ q: canonicalQuery, userId })),
  );
  const id =
    "test:" +
    [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const monitor: Monitor = {
    ...monitorSchema.parse({
      name: "Teste manual Bright Data",
      query: q.type === "keyword" ? q.keyword : "",
      queryType: q.type,
      providerFilters: q.filters,
      providerContractFingerprint: q.contractFingerprint,
      searchUrl: q.type === "search_url" ? q.url : null,
      provider: "brightdata",
      city: "",
    }),
    id,
    revision: 1,
  };
  return {
    queued: await enqueueMonitor(db, userId, monitor, true, {
      kind: "test",
      monitor,
      limit,
    }),
  };
}
export async function reserveBudget(
  db: Database,
  provider: string,
  max: number,
) {
  return !!(
    await db
      .prepare(
        "INSERT INTO rate_limits (key,window,count) VALUES (?,0,1) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<?",
      )
      .bind(providerBudgetKey(provider), max)
      .run()
  ).meta.changes;
}
export async function runOne(
  db: Database,
  userId: string,
  providerFactory: (id: string) => MarketplaceProvider,
  configOrLimit: PilotConfig | number = defaults,
) {
  const config =
    typeof configOrLimit === "number"
      ? { ...defaults, maxDailyTriggers: configOrLimit }
      : configOrLimit;
  const now = new Date(),
    token = uid();
  const job = await db
    .prepare(
      "UPDATE jobs SET status='running',lease_token=?,lease_until=? WHERE id=(SELECT id FROM jobs WHERE user_id=? AND available_at<=? AND (status='pending' OR (status='running' AND lease_until<?)) ORDER BY priority DESC,created_at LIMIT 1) RETURNING *",
    )
    .bind(
      token,
      new Date(+now + 120000).toISOString(),
      userId,
      now.toISOString(),
      now.toISOString(),
    )
    .first<Job>();
  if (!job) return { status: "idle" };
  const lease = jobLease(db, job.id, token);
  db = lease.db;
  const payload = JSON.parse(job.payload) as Payload;
  const current =
    payload.kind === "test"
      ? payload.monitor
      : (await getMonitors(db, userId)).find((m) => m.id === job.monitor_id);
  const unchanged =
    !!current?.active &&
    job.scope_id === `${current.id}:${current.provider}:${current.revision}`;
  // Once paid work has a snapshot, finish that exact snapshot even after pause/edit.
  // Its original query is immutable; current commercial rules govern alerts.
  const m = payload.cursor ? (payload.monitor ?? current) : current;
  if (!m || m.provider !== "brightdata" || (!payload.cursor && !unchanged)) {
    const status = payload.triggerStarted ? "dead" : "canceled";
    await db.batch([
      db
        .prepare("UPDATE jobs SET status=? WHERE id=? AND lease_token=?")
        .bind(status, job.id, token),
      db
        .prepare("UPDATE provider_runs SET status=?,completed_at=? WHERE id=?")
        .bind(status, now.toISOString(), job.id),
    ]);
    return { status, jobId: job.id };
  }
  const scope = await db
    .prepare(
      "SELECT baseline_complete,sequence,failures FROM monitor_scopes WHERE id=?",
    )
    .bind(job.scope_id)
    .first<{ baseline_complete: number; sequence: number; failures: number }>();
  const requested = Math.min(
      payload.limit ?? m.resultsPerSearch ?? config.maxRecords,
      config.maxRecords,
    ),
    method = m.queryType ?? "keyword";
  const startedAt = payload.startedAt ?? now.toISOString();
  payload.startedAt = startedAt;
  await db
    .prepare(
      "INSERT INTO provider_runs (id,user_id,monitor_id,provider,query_type,kind,status,started_at,records_requested) VALUES (?,?,?,?,?,?,'running',?,?) ON CONFLICT(id) DO UPDATE SET status='running'",
    )
    .bind(
      job.id,
      userId,
      m.id,
      m.provider,
      method,
      payload.kind ?? "monitor",
      startedAt,
      requested,
    )
    .run();
  let reserved = false;
  try {
    if (!scope) throw new ProviderError("Escopo do monitor ausente", false);
    if (!payload.cursor && config.collectionEnabled === false) {
      await db.batch([
        db
          .prepare(
            "UPDATE provider_runs SET status='paused',completed_at=NULL WHERE id=? AND user_id=?",
          )
          .bind(job.id, userId),
        db
          .prepare(
            "UPDATE jobs SET status='pending',available_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
          )
          .bind(new Date(Date.now() + 60000).toISOString(), job.id, token),
      ]);
      return { status: "collection_disabled", jobId: job.id };
    }
    if (!payload.cursor && payload.triggerStarted)
      throw new ProviderError(
        "Disparo anterior sem confirmação. Verifique o fornecedor antes de repetir a cobrança.",
        false,
      );
    const terms =
      method === "search_url"
        ? [m.searchUrl!]
        : payload.kind === "test"
          ? [m.query]
          : expandQueries(m.product || m.query, m.aliases);
    for (const q of terms)
      await db
        .prepare(
          "INSERT OR IGNORE INTO search_queries (id,user_id,monitor_id,query,runs,discoveries) VALUES (?,?,?,?,0,0)",
        )
        .bind(uid(), userId, m.id, q)
        .run();
    const stats = (
      await all<{ query: string; runs: number; discoveries: number }>(
        db,
        "SELECT query,runs,discoveries FROM search_queries WHERE user_id=? AND monitor_id=?",
        userId,
        m.id,
      )
    )
      .filter((s) => terms.includes(s.query))
      .sort((a, b) => terms.indexOf(a.query) - terms.indexOf(b.query));
    const query =
      payload.query ??
      (method === "search_url"
        ? m.searchUrl!
        : (selectQueries(
            stats.map((q) => ({ ...q, text: q.query })),
            1,
          )[0] ?? m.query));
    payload.query = query;
    const provider = providerFactory(m.provider);
    let nativeQuery: ProviderQuery;
    try {
      nativeQuery =
        payload.providerQuery ??
        providerQuery(
          query,
          method,
          m.searchUrl,
          m.providerFilters,
          m.providerContractFingerprint,
        );
      payload.providerQuery = nativeQuery;
      if (!payload.cursor)
        await db
          .prepare("UPDATE provider_runs SET request_snapshot=? WHERE id=?")
          .bind(
            JSON.stringify({
              query: nativeQuery,
              limit: Math.min(requested, config.maxRecords),
            }),
            job.id,
          )
          .run();
    } catch (error) {
      const failure = new ProviderError(
        error instanceof Error ? error.message : "Consulta inválida",
        false,
      );
      failure.phase = "preflight";
      throw failure;
    }
    if (!payload.cursor) {
      const used = await db
        .prepare("SELECT count FROM rate_limits WHERE key=?")
        .bind(providerBudgetKey(m.provider))
        .first<{ count: number }>();
      if ((used?.count ?? 0) >= config.maxDailyTriggers) {
        const e = new ProviderError(
          "Limite diário atingido. Nova coleta disponível após 00:00 UTC.",
          false,
        );
        e.code = "budget_blocked";
        throw e;
      }
      try {
        const rawHealth = await provider.healthCheck();
        const health = confirmedHealth(
          rawHealth,
          rawHealth.dataset ?? "",
          await readInputConfirmation(db, rawHealth.dataset ?? ""),
        );
        await lease.renew();
        if (!health.ok || (health.methods && !health.methods[method]))
          throw new ProviderError(health.message, false);
        // The user-facing city may predate provider validation. Resolve it
        // against the live schema before budgeting/triggering, never on polling.
        nativeQuery = withKeywordCity(
          nativeQuery,
          health.schemas?.[method],
          m.city,
        );
        if (payload.kind !== "test" && health.schemas?.[method])
          nativeQuery = nativeRadius(
            nativeQuery,
            health.schemas?.[method],
            m.radiusKm,
          );
        const temporal = nativePublicationPolicy(
          nativeQuery,
          health.schemas?.[method],
          Math.min(m.maxListingAgeMinutes ?? 10080, 10080),
        );
        if (payload.kind !== "test") {
          if (temporal.issue && health.schemas?.[method])
            nativeFilterError(temporal.issue);
          if (
            provider.prepareQuery &&
            !health.schemas?.[method] &&
            method === "keyword"
          )
            nativeFilterError(
              "O contrato da fonte não confirmou os filtros. Valide a configuração na Administração.",
            );
          nativeQuery = temporal.query;
        }
        payload.providerQuery = nativeQuery;
        const prepared = await provider.prepareQuery?.(nativeQuery);
        if (prepared)
          await db
            .prepare("UPDATE provider_runs SET request_snapshot=? WHERE id=?")
            .bind(
              JSON.stringify({
                query: nativeQuery,
                publicationFilter:
                  payload.kind === "test"
                    ? null
                    : {
                        coverage: temporal.coverage,
                        days: temporal.days,
                        requestedMinutes: Math.min(
                          m.maxListingAgeMinutes ?? 10080,
                          10080,
                        ),
                      },
                radiusFilter:
                  payload.kind === "test"
                    ? null
                    : {
                        requestedKm: m.radiusKm,
                        sentValue: prepared.input.radius ?? null,
                        sentUnit:
                          health.schemas?.[method]?.fields.find(
                            (f) => f.name === "radius",
                          )?.unit ?? null,
                      },
                inputConfirmationId:
                  health.schemas?.[method]?.inputConfirmationId ?? null,
                ...prepared,
                limit: Math.min(requested, config.maxRecords),
              }),
              job.id,
            )
            .run();
      } catch (e) {
        if (e instanceof LeaseLost) throw e;
        const p =
          e instanceof ProviderError
            ? e
            : new ProviderError("Falha ao validar o contrato", true);
        p.phase = "preflight";
        throw p;
      }
      await lease.renew();
      reserved =
        config.tenantMaxDailyTriggers === undefined
          ? await reserveBudget(db, m.provider, config.maxDailyTriggers)
          : await reserveAccountBudget(
              db,
              userId,
              `${job.id}:${job.attempts}`,
              m.provider,
              config.maxDailyTriggers,
              config.tenantMaxDailyTriggers,
            );
      if (!reserved) {
        const e = new ProviderError("Limite diário atingido.", false);
        e.code = "budget_blocked";
        throw e;
      }
      payload.triggerStarted = true;
      await db
        .prepare("UPDATE jobs SET payload=? WHERE id=? AND lease_token=?")
        .bind(JSON.stringify(payload), job.id, token)
        .run();
    }
    await lease.renew();
    const result = await provider.search({
      query,
      providerQuery: nativeQuery,
      city: m.city,
      radiusKm: m.radiusKm,
      cursor: payload.cursor,
      sequence: scope.sequence + (scope.baseline_complete ? 1 : 0),
      limit: requested,
    });
    await lease.renew();
    if (!result.complete) {
      if (
        (payload.polls ?? 0) >= 90 ||
        Date.now() - Date.parse(startedAt) > 1800000
      )
        throw new ProviderError(
          "Coleta excedeu 30 minutos; snapshot preservado para revisão",
          false,
        );
      if (!result.cursor)
        throw new ProviderError("Resposta pendente sem snapshot", false);
      Object.assign(payload, {
        cursor: result.cursor,
        polls: (payload.polls ?? 0) + 1,
        triggerStarted: true,
      });
      await db.batch([
        db
          .prepare(
            "UPDATE jobs SET status='pending',payload=?,available_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
          )
          .bind(
            JSON.stringify(payload),
            new Date(Date.now() + 15000).toISOString(),
            job.id,
            token,
          ),
        db
          .prepare(
            "UPDATE provider_runs SET status='waiting',snapshot_id=? WHERE id=?",
          )
          .bind(result.cursor, job.id),
      ]);
      return {
        status: "waiting",
        jobId: job.id,
        snapshotId: result.cursor,
        warnings: result.warnings,
      };
    }
    if (result.items.some((l) => l.demo || l.provider !== "brightdata"))
      throw new ProviderError(
        "Origem não permitida na operação real; nenhum registro foi persistido",
        false,
      );
    const received = result.received ?? result.items.length,
      known = result.items.filter(
        (l) => l.publishedAt && l.publicationConfidence >= 70,
      ).length;
    await db
      .prepare(
        "UPDATE provider_runs SET status='processing',records_received=?,accepted=?,rejected=?,known_publication=?,unknown_publication=?,snapshot_id=?,errors=?,candidates_found=? WHERE id=?",
      )
      .bind(
        received,
        result.items.length,
        result.rejected ?? 0,
        known,
        result.items.length - known,
        result.snapshotId ?? payload.cursor ?? null,
        JSON.stringify(result.qualityErrors ?? {}),
        result.candidates?.length ?? 0,
        job.id,
      )
      .run();
    if (received > 0 && !result.items.length && !result.candidates?.length)
      throw new ProviderError(
        "Nenhum registro válido recebido. Baseline não concluído; veja registros rejeitados.",
        false,
      );
    const observedAt = new Date();
    const initialQuery = !stats.find((s) => s.query === query)?.runs;
    const baseline =
      payload.kind === "test" || !scope.baseline_complete || initialQuery;
    await saveCandidates(
      db,
      userId,
      job.scope_id,
      job.id,
      result.candidates ?? [],
      baseline,
      observedAt,
    );
    const items = result.items.map((l) => ({
      ...l,
      queryType: method,
      snapshotId: result.snapshotId ?? payload.cursor ?? null,
    }));
    const latest =
      payload.kind === "test"
        ? m
        : (await getMonitors(db, userId)).find((row) => row.id === m.id);
    const sameScope =
      !!latest?.active &&
      job.scope_id === `${latest.id}:${latest.provider}:${latest.revision}`;
    const outcome = await ingest(
      db,
      userId,
      sameScope ? latest! : m,
      items,
      baseline,
      await getSettings(db, userId),
      observedAt,
      payload.kind !== "test" && sameScope,
      config.externalAlerts,
    );
    const observations = [];
    for (const raw of items) {
      if (raw.demo) continue;
      const row = await db
        .prepare(
          "SELECT data FROM listings WHERE user_id=? AND marketplace=? AND external_id=? AND demo=0",
        )
        .bind(userId, raw.marketplace, raw.externalId)
        .first<{ data: string }>();
      if (!row) continue;
      const l = JSON.parse(row.data) as Listing;
      const candidate = await db
        .prepare(
          "SELECT c.first_seen_at,c.baseline FROM discovery_candidates c JOIN provider_runs r ON r.id=c.last_run_id AND r.user_id=c.user_id WHERE c.user_id=? AND c.provider=? AND r.query_type=? AND c.external_id=? ORDER BY c.first_seen_at LIMIT 1",
        )
        .bind(userId, m.provider, method, raw.externalId)
        .first<{ first_seen_at: string; baseline: number }>();
      const firstObservation =
        candidate?.first_seen_at ?? observedAt.toISOString();
      observations.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO discovery_observations (id,user_id,listing_id,provider,query_type,monitor_id,run_id,first_seen_at,published_at,publication_status,publication_confidence,delay_seconds,baseline,city,snapshot_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            uid(),
            userId,
            l.id,
            m.provider,
            method,
            m.id,
            job.id,
            firstObservation,
            raw.publishedAt,
            raw.publicationStatus ?? (raw.publishedAt ? "valid" : "missing"),
            raw.publicationConfidence,
            discoveryDelay({ ...raw, firstSeenAt: firstObservation }),
            Number(baseline || !!candidate?.baseline),
            raw.city,
            raw.snapshotId ?? null,
          ),
      );
    }
    await batch(db, observations);
    const completed = new Date().toISOString(),
      latency = Date.now() - Date.parse(startedAt);
    await db.batch([
      db
        .prepare(
          "UPDATE monitor_scopes SET baseline_complete=1,sequence=sequence+1,failures=0,next_run_at=? WHERE id=?",
        )
        .bind(
          new Date(
            Date.now() +
              Math.max(
                config.minInterval ?? 60,
                nextInterval(
                  Math.max(
                    config.pilot ? 900 : 60,
                    config.minInterval ?? 60,
                    m.intervalSeconds,
                  ),
                  outcome.discoveries,
                ),
              ) *
                1000,
          ).toISOString(),
          job.scope_id,
        ),
      db
        .prepare(
          "UPDATE jobs SET status='done',error=NULL,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
        )
        .bind(job.id, token),
      db
        .prepare(
          "UPDATE search_queries SET runs=runs+1,discoveries=discoveries+? WHERE user_id=? AND monitor_id=? AND query=?",
        )
        .bind(outcome.funnel.withinBudget, userId, m.id, query),
      db
        .prepare(
          "UPDATE provider_runs SET status=?,completed_at=?,latency_ms=?,new_listings=?,duplicates=?,rejected=rejected+?,price_changes=?,baseline=?,summary=? WHERE id=?",
        )
        .bind(
          result.candidates?.length ? "needs_details" : "completed",
          completed,
          latency,
          outcome.discoveries,
          outcome.duplicates,
          outcome.rejected,
          outcome.priceChanges,
          Number(baseline),
          JSON.stringify(outcome.funnel),
          job.id,
        ),
      db
        .prepare(
          "INSERT INTO provider_health (id,user_id,provider,ok,latency_ms,volume,error,checked_at) VALUES (?,?,?,1,?,?,NULL,?)",
        )
        .bind(
          uid(),
          userId,
          m.provider,
          latency,
          outcome.analyzed - outcome.rejected,
          completed,
        ),
    ]);
    return {
      status: "done",
      jobId: job.id,
      ...outcome,
      snapshotId: result.snapshotId ?? payload.cursor ?? null,
      received,
      baseline,
      candidates: result.candidates?.length ?? 0,
      warnings: result.warnings,
    };
  } catch (e) {
    if (e instanceof LeaseLost) return { status: "lease_lost", jobId: job.id };
    try {
      await lease.renew();
    } catch (lost) {
      if (lost instanceof LeaseLost)
        return { status: "lease_lost", jobId: job.id };
      throw lost;
    }
    const error =
      e instanceof ProviderError
        ? e
        : new ProviderError(
            "Falha interna durante a coleta; consulte o identificador da execução",
            true,
          );
    error.phase ??= payload.cursor
      ? "poll"
      : payload.triggerStarted
        ? "trigger"
        : "preflight";
    if (error.phase === "preflight") {
      payload.triggerStarted = false;
      if (reserved && config.tenantMaxDailyTriggers !== undefined)
        await refundAccountBudget(db, userId, `${job.id}:${job.attempts}`);
      else if (reserved)
        await db
          .prepare("UPDATE rate_limits SET count=MAX(0,count-1) WHERE key=?")
          .bind(providerBudgetKey(m.provider))
          .run();
    }
    if (error.triggerRejected) payload.triggerStarted = false;
    const budgetBlocked = error.code === "budget_blocked",
      attempts = job.attempts + 1,
      retry = retryDelay(attempts, error.retryAfter),
      dead = attempts >= 5 || !error.retryable;
    const next = budgetBlocked
      ? new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString()
      : new Date(Date.now() + (dead ? 3600 : retry) * 1000).toISOString();
    await db.batch([
      db
        .prepare(
          "UPDATE jobs SET status=?,attempts=?,error=?,payload=?,available_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
        )
        .bind(
          budgetBlocked ? "budget_blocked" : dead ? "dead" : "pending",
          attempts,
          error.message,
          JSON.stringify(payload),
          next,
          job.id,
          token,
        ),
      db
        .prepare(
          "UPDATE monitor_scopes SET failures=failures+1,next_run_at=? WHERE id=?",
        )
        .bind(next, job.scope_id),
      db
        .prepare(
          "UPDATE provider_runs SET status=?,completed_at=?,latency_ms=?,errors=json_set(errors,'$.message',?,'$.phase',?,'$.code',?) WHERE id=?",
        )
        .bind(
          budgetBlocked ? "budget_blocked" : dead ? "failed" : "retry",
          dead ? new Date().toISOString() : null,
          Date.now() - Date.parse(startedAt),
          error.message,
          error.phase,
          error.code ?? null,
          job.id,
        ),
      db
        .prepare(
          "INSERT INTO provider_health (id,user_id,provider,ok,latency_ms,volume,error,checked_at) VALUES (?,?,?,0,?,0,?,?)",
        )
        .bind(
          uid(),
          userId,
          m.provider,
          Date.now() - Date.parse(startedAt),
          error.message,
          new Date().toISOString(),
        ),
    ]);
    return {
      status: budgetBlocked ? "budget_blocked" : dead ? "dead" : "retry",
      jobId: job.id,
      error: error.message,
      phase: error.phase,
      code: error.code ?? null,
      snapshotId: payload.cursor ?? null,
      retrySeconds: dead ? null : retry,
    };
  }
}
