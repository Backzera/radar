import { z } from "zod";
import type { Opportunity, Listing } from "../core/types";
import { fold } from "../core/text";
import {
  all,
  getMonitors,
  getPurchases,
  getSettings,
  uid,
  type Database,
} from "./store";
import { currentListing, evaluate, type Sighting } from "./evaluation";
import { matchesMonitor } from "../core/opportunity";
import { ensureUser } from "./seed";
import { groupPricer } from "../core/pricing-context";
import { calibrationFactor } from "../core/trading";
export const RULE_VERSION = "saas-2.0-exact-recency-v2";
export const feedQuerySchema = z
  .object({
    q: z.string().max(150).default(""),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    sort: z.enum(["relevance", "price", "recent"]).default("relevance"),
    filter: z
      .enum([
        "all",
        "budget",
        "qualified",
        "baseline",
        "new",
        "price_drop",
        "saved",
        "dismissed",
        "review",
        "history",
      ])
      .default("all"),
    monitorId: z.string().max(200).default(""),
  })
  .strict();
type FeedState = {
  generation: string | null;
  source_version: number;
  rule_version: string;
  built_at: string | null;
  lease_token: string | null;
  lease_until: string | null;
};
export class FeedBusy extends Error {
  constructor() {
    super("Resultados sendo atualizados. Tente novamente em instantes.");
  }
}
export function summary(o: Opportunity): Opportunity {
  return {
    listing: {
      ...o.listing,
      title: o.listing.title.slice(0, 200),
      description: "",
      images: o.listing.images.slice(0, 1).filter((u) => u.length <= 2048),
      seenBy: [],
      fingerprint: "",
      sellerId: null,
    },
    analysis: {
      ...o.analysis,
      matchReasons: o.analysis.matchReasons?.slice(0, 5),
      pricing: { ...o.analysis.pricing, comparables: [] },
    },
  };
}
export async function ensureFeed(
  db: Database,
  userId: string,
  now = new Date(),
) {
  await ensureUser(db, userId);
  await db
    .prepare("INSERT OR IGNORE INTO feed_state(user_id) VALUES (?)")
    .bind(userId)
    .run();
  const revision =
    (
      await db
        .prepare("SELECT version FROM feed_revisions WHERE user_id=?")
        .bind(userId)
        .first<{ version: number }>()
    )?.version ?? 0;
  const old = (await db
    .prepare("SELECT * FROM feed_state WHERE user_id=?")
    .bind(userId)
    .first<FeedState>())!;
  if (
    old.generation &&
    old.source_version === revision &&
    old.rule_version === RULE_VERSION &&
    old.built_at &&
    +now - Date.parse(old.built_at) < 60000
  )
    return { generation: old.generation, assessedAt: old.built_at };
  const token = uid(),
    generation = uid();
  const lock = await db
    .prepare(
      "UPDATE feed_state SET lease_token=?,lease_until=? WHERE user_id=? AND (lease_until IS NULL OR lease_until<?)",
    )
    .bind(
      token,
      new Date(+now + 120000).toISOString(),
      userId,
      now.toISOString(),
    )
    .run();
  if (!lock.meta.changes) throw new FeedBusy();
  try {
    const [raw, monitors, sightings, settings, purchases] = await Promise.all([
      all<{ data: string }>(
        db,
        "SELECT data FROM listings WHERE user_id=? AND demo=0 ORDER BY last_seen_at DESC,id",
        userId,
      ),
      getMonitors(db, userId),
      all<Sighting>(
        db,
        "SELECT monitor_id,listing_id,provider,revision,baseline FROM monitor_sightings WHERE user_id=?",
        userId,
      ),
      getSettings(db, userId),
      getPurchases(db, userId, true),
    ]);
    const groups = new Map<string, Listing[]>();
    for (const r of raw) {
      const l = currentListing(JSON.parse(r.data));
      const key = l.product.key ?? `unknown:${l.id}`;
      const g = groups.get(key) ?? [];
      g.push(l);
      groups.set(key, g);
    }
    const sightById = new Map<string, Sighting[]>();
    for (const s of sightings) {
      const group = sightById.get(s.listing_id) ?? [];
      group.push(s);
      sightById.set(s.listing_id, group);
    }
    let records: unknown[][] = [];
    const flush = async () => {
      if (!records.length) return;
      // One bounded JSON parameter, one statement per page of summaries.
      // JSON values stay parameters; product text never becomes SQL syntax.
      await db
        .prepare(
          "INSERT INTO feed_entries SELECT " +
            Array.from(
              { length: 13 },
              (_, i) => `json_extract(value,'$[${i}]')`,
            ).join(",") +
            " FROM json_each(?)",
        )
        .bind(JSON.stringify(records))
        .run();
      records = [];
    };
    for (const pool of groups.values()) {
      const pricing = groupPricer(
        pool,
        settings,
        now,
        calibrationFactor(pool[0], pool, purchases),
      );
      for (const l of pool) {
        const evaluated = evaluate(
          l,
          pool,
          monitors,
          sightById.get(l.id) ?? [],
          settings,
          purchases,
          now,
          pricing,
        );
        const o = summary(evaluated);
        const assessments = evaluated.assessments.map(
          (analysis) => summary({ listing: l, analysis }).analysis,
        );
        const monitorIds = monitors
          .filter(
            (m) =>
              m.active &&
              !m.archived &&
              matchesMonitor(l, m) &&
              (m.queryType !== "search_url" ||
                (sightById.get(l.id) ?? []).some(
                  (s) => s.monitor_id === m.id && s.revision === m.revision,
                )),
          )
          .map((m) => m.id);
        records.push([
          userId,
          generation,
          l.id,
          fold(`${l.title} ${l.description}`),
          l.price,
          o.analysis.score,
          Number(o.analysis.eligible),
          Number(o.analysis.budgetEligible),
          o.analysis.event,
          l.publishedAt,
          l.lastSeenAt,
          JSON.stringify(monitorIds),
          JSON.stringify({ ...o, assessments }),
        ]);
        if (records.length === 40) await flush();
      }
    }
    await flush();
    // Publish only a complete, still-current generation owned by this builder.
    const published = await db
      .prepare(
        "UPDATE feed_state SET generation=?,source_version=?,rule_version=?,built_at=?,lease_token=NULL,lease_until=NULL WHERE user_id=? AND lease_token=? AND lease_until>? AND COALESCE((SELECT version FROM feed_revisions WHERE user_id=?),0)=?",
      )
      .bind(
        generation,
        revision,
        RULE_VERSION,
        now.toISOString(),
        userId,
        token,
        new Date().toISOString(),
        userId,
        revision,
      )
      .run();
    if (!published.meta.changes) throw new FeedBusy();
    if (old.generation)
      await db
        .prepare("DELETE FROM feed_entries WHERE user_id=? AND generation=?")
        .bind(userId, old.generation)
        .run();
    return { generation, assessedAt: now.toISOString() };
  } catch (error) {
    await db
      .prepare("DELETE FROM feed_entries WHERE user_id=? AND generation=?")
      .bind(userId, generation)
      .run();
    throw error;
  } finally {
    await db
      .prepare(
        "UPDATE feed_state SET lease_token=NULL,lease_until=NULL WHERE user_id=? AND lease_token=?",
      )
      .bind(userId, token)
      .run();
  }
}
export async function getFeed(
  db: Database,
  userId: string,
  input: unknown = {},
) {
  const q = feedQuerySchema.parse(input),
    fresh = await ensureFeed(db, userId);
  const where = ["f.user_id=?", "f.generation=?"];
  const values: unknown[] = [userId, fresh.generation];
  if (q.q) {
    where.push("f.search_text LIKE ? ESCAPE '!'");
    values.push("%" + fold(q.q).replace(/[!%_]/g, "!$&") + "%");
  }
  if (q.monitorId) {
    where.push("EXISTS (SELECT 1 FROM json_each(f.monitor_ids) WHERE value=?)");
    values.push(q.monitorId);
    if (!["saved", "dismissed", "history", "review"].includes(q.filter)) {
      where.push(
        "EXISTS (SELECT 1 FROM json_each(f.data,'$.assessments') a WHERE json_extract(a.value,'$.monitorId')=? AND json_extract(a.value,'$.budgetEligible')=1 AND json_extract(a.value,'$.displayExpiresAt')>=?" +
          (q.filter === "qualified"
            ? " AND json_extract(a.value,'$.eligible')=1"
            : "") +
          ")",
      );
      values.push(q.monitorId, new Date().toISOString());
    }
  }
  // Registros antigos continuam no histórico, mas nunca na vitrine ativa.
  if (!["saved", "dismissed", "history", "review"].includes(q.filter)) {
    where.push(
      "f.budget=1",
      "EXISTS (SELECT 1 FROM json_each(f.data,'$.assessments') a WHERE json_extract(a.value,'$.budgetEligible')=1 AND json_extract(a.value,'$.displayExpiresAt')>=?" +
        (q.filter === "qualified"
          ? " AND json_extract(a.value,'$.eligible')=1"
          : "") +
        ")",
    );
    values.push(new Date().toISOString());
  }
  if (q.filter === "review") {
    where.push("json_array_length(f.monitor_ids)>0", "f.budget=0");
  }
  if (q.filter === "budget") where.push("f.budget=1");
  if (q.filter === "qualified") where.push("f.eligible=1");
  if (["baseline", "new", "price_drop"].includes(q.filter)) {
    where.push("f.event=?");
    values.push(q.filter);
  }
  if (q.filter === "saved") where.push("COALESCE(p.saved,0)=1");
  if (q.filter === "dismissed") where.push("COALESCE(p.dismissed,0)=1");
  else where.push("COALESCE(p.dismissed,0)=0");
  const from =
    "FROM feed_entries f LEFT JOIN listing_preferences p ON p.user_id=f.user_id AND p.listing_id=f.listing_id WHERE " +
    where.join(" AND ");
  const order =
    q.sort === "price"
      ? "f.price IS NULL,f.price,f.listing_id"
      : q.sort === "recent"
        ? "f.published_at IS NULL,f.published_at DESC,f.listing_id"
        : "f.eligible DESC,f.budget DESC,f.score DESC,f.listing_id";
  const count =
    (
      await db
        .prepare("SELECT COUNT(*) AS n " + from)
        .bind(...values)
        .first<{ n: number }>()
    )?.n ?? 0;
  const rows = await all<{ data: string; saved: number; dismissed: number }>(
    db,
    "SELECT f.data,COALESCE(p.saved,0) AS saved,COALESCE(p.dismissed,0) AS dismissed " +
      from +
      " ORDER BY " +
      order +
      " LIMIT ? OFFSET ?",
    ...values,
    q.limit,
    (q.page - 1) * q.limit,
  );
  return {
    items: rows.map((r) => {
      const { assessments, ...o } = JSON.parse(r.data) as Opportunity & {
        assessments?: Opportunity["analysis"][];
      };
      if (q.monitorId) {
        const selected = assessments?.find((a) => a.monitorId === q.monitorId);
        if (selected) o.analysis = selected;
      } else if (
        !["saved", "dismissed", "history", "review"].includes(q.filter)
      ) {
        const time = new Date().toISOString();
        const selected = assessments?.find(
          (a) =>
            a.budgetEligible &&
            a.displayExpiresAt &&
            a.displayExpiresAt >= time &&
            (q.filter !== "qualified" || a.eligible),
        );
        if (selected) o.analysis = selected;
      }
      return { ...o, saved: !!r.saved, dismissed: !!r.dismissed };
    }),
    total: count,
    page: q.page,
    limit: q.limit,
    hasNext: q.page * q.limit < count,
    assessedAt: fresh.assessedAt,
    ruleVersion: RULE_VERSION,
  };
}
export const preferenceSchema = z
  .object({
    saved: z.boolean().optional(),
    dismissed: z.boolean().optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .strict();
export async function saveListingPreference(
  db: Database,
  userId: string,
  id: string,
  input: unknown,
) {
  const d = preferenceSchema.parse(input);
  if (
    !(await db
      .prepare("SELECT id FROM listings WHERE user_id=? AND id=? AND demo=0")
      .bind(userId, id)
      .first())
  )
    throw new Error("NOT_FOUND");
  await db
    .prepare(
      `INSERT INTO listing_preferences(user_id,listing_id,saved,dismissed,reason,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id,listing_id) DO UPDATE SET saved=COALESCE(?,saved),dismissed=COALESCE(?,dismissed),reason=COALESCE(?,reason),updated_at=excluded.updated_at`,
    )
    .bind(
      userId,
      id,
      Number(d.saved ?? false),
      Number(d.dismissed ?? false),
      d.reason ?? null,
      new Date().toISOString(),
      d.saved === undefined ? null : Number(d.saved),
      d.dismissed === undefined ? null : Number(d.dismissed),
      d.reason ?? null,
    )
    .run();
  return { saved: true };
}
