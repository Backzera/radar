import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Database } from "../server/store";
import type { Listing, Monitor } from "../core/types";
import { DEFAULT_SETTINGS } from "../core/types";
import { demoBaseline, demoNew } from "./mock";
import { materialize } from "../server/ingestion";
export const now = new Date("2026-09-10T15:00:00Z");
export const monitor: Monitor = {
  id: "m1",
  name: "iPhone 15",
  query: "iPhone 15",
  aliases: [],
  negatives: [],
  minPrice: 0,
  maxPrice: 5000,
  city: "Curitiba",
  radiusKm: 30,
  latitude: null,
  longitude: null,
  condition: "any",
  active: true,
  mode: "automatic",
  manualPrice: null,
  strongPrice: null,
  ultraPrice: null,
  minRoi: 20,
  maxRisk: 35,
  minLiquidity: 0,
  minScore: 65,
  intervalSeconds: 120,
  provider: "brightdata",
  revision: 1,
};
export function fixture(): { listing: Listing; pool: Listing[] } {
  const listing = materialize(
    { ...demoNew(0, 0, now), demo: false, provider: "brightdata" },
    false,
    now,
  );
  return {
    listing,
    pool: demoBaseline(now).map((r) =>
      materialize({ ...r, demo: false, provider: "brightdata" }, true, now),
    ),
  };
}
export function database() {
  const sql = new DatabaseSync(":memory:");
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(`drizzle/${file}`, "utf8"));
  const prepare = (query: string) => {
    let params: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) {
        params = values;
        return statement;
      },
      async all() {
        const results = sql.prepare(query).all(...(params as never[]));
        return {
          results,
          success: true,
          meta: { changes: sql.prepare("SELECT changes() AS n").get()!.n },
        };
      },
      async first(column?: string) {
        const r = sql.prepare(query).get(...(params as never[])) as
          Record<string, unknown> | undefined;
        return column ? (r?.[column] ?? null) : (r ?? null);
      },
      async run() {
        const r = sql.prepare(query).run(...(params as never[]));
        return {
          results: [],
          success: true,
          meta: {
            changes: Number(r.changes),
            last_row_id: Number(r.lastInsertRowid),
          },
        };
      },
    };
    return statement;
  };
  const db = {
    prepare,
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as Database;
  const createUser = async (id = "u1") => {
    await db
      .prepare(
        "INSERT INTO users (id,created_at,settings,demo_seeded) VALUES (?,?,?,1)",
      )
      .bind(id, now.toISOString(), JSON.stringify(DEFAULT_SETTINGS))
      .run();
  };
  return { db, sql, createUser };
}
