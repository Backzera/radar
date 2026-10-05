/**
 * D1-compatible database over node:sqlite, for self-hosting on a VPS.
 * The app talks to D1 (prepare/bind/first/all/run/batch); this gives it the
 * same surface over a single SQLite file.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Value = string | number | null | bigint | Uint8Array;
const normalize = (value: unknown): Value => {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return Number(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value as Value;
};

export interface NodeStatement {
  query: string;
  params: Value[];
  bind(...values: unknown[]): NodeStatement;
  all<T = Record<string, unknown>>(): Promise<{
    results: T[];
    success: true;
    meta: { changes: number; last_row_id: number; duration: number };
  }>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run(): Promise<RunResult>;
}
interface RunResult {
  results: [];
  success: true;
  meta: { changes: number; last_row_id: number; duration: number };
}

export function createNodeDatabase(file: string) {
  mkdirSync(dirname(file), { recursive: true });
  const sql = new DatabaseSync(file);
  // D1 enforces foreign keys; WAL keeps reads going while a write commits.
  sql.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;",
  );
  const cache = new Map<string, StatementSync>();
  const compiled = (query: string) => {
    let statement = cache.get(query);
    if (!statement) {
      statement = sql.prepare(query);
      cache.set(query, statement);
    }
    return statement;
  };
  // Synchronous on purpose: a batch runs start to end inside one transaction,
  // with no other request interleaving on this single Node thread.
  const runSync = (query: string, params: Value[]): RunResult => {
    const result = compiled(query).run(...params);
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
        duration: 0,
      },
    };
  };
  const make = (query: string, params: Value[] = []): NodeStatement => ({
    query,
    params,
    bind: (...values) => make(query, values.map(normalize)),
    // node:sqlite rows have a null prototype; D1 returns plain objects.
    all: async <T,>() => ({
      results: compiled(query)
        .all(...params)
        .map((row) => ({ ...row })) as T[],
      success: true as const,
      meta: { changes: 0, last_row_id: 0, duration: 0 },
    }),
    first: async <T,>(column?: string) => {
      const row = compiled(query).get(...params) as Record<string, unknown> | undefined;
      if (!row) return null;
      return (column ? (row[column] ?? null) : { ...row }) as T;
    },
    run: async () => runSync(query, params),
  });
  return {
    sql,
    close: () => sql.close(),
    prepare: (query: string) => make(query),
    async batch(statements: NodeStatement[]) {
      sql.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((s) => runSync(s.query, s.params));
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
export type NodeDatabase = ReturnType<typeof createNodeDatabase>;

/**
 * Applies drizzle/*.sql in order, once each. A migration whose file changed
 * after being applied stops the start instead of guessing. The database is
 * copied before new migrations run on existing data.
 */
export function migrate(db: NodeDatabase, dir: string, backupDir: string) {
  const { sql } = db;
  sql.exec(
    "CREATE TABLE IF NOT EXISTS _brique_migrations (name TEXT PRIMARY KEY NOT NULL, hash TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  if (!existsSync(dir)) throw new Error(`Pasta de migrations não encontrada: ${dir}`);
  const applied = new Map(
    (sql.prepare("SELECT name,hash FROM _brique_migrations").all() as { name: string; hash: string }[]).map(
      (r) => [r.name, r.hash],
    ),
  );
  const pending: { name: string; content: string; hash: string }[] = [];
  for (const name of readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(f))
    .sort()) {
    const content = readFileSync(join(dir, name), "utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    const previous = applied.get(name);
    if (previous && previous !== hash)
      throw new Error(`A migration ${name} mudou depois de aplicada. Restaure o arquivo original.`);
    if (!previous) pending.push({ name, content, hash });
  }
  if (!pending.length) return [];
  if (applied.size) {
    mkdirSync(backupDir, { recursive: true });
    sql
      .prepare("VACUUM INTO ?")
      .run(join(backupDir, `brique-before-${pending[0].name.slice(0, 4)}-${Date.now()}.sqlite`));
  }
  sql.exec("BEGIN IMMEDIATE");
  try {
    for (const m of pending) {
      sql.exec(m.content);
      sql
        .prepare("INSERT INTO _brique_migrations (name,hash,applied_at) VALUES (?,?,?)")
        .run(m.name, m.hash, new Date().toISOString());
    }
    sql.exec("COMMIT");
  } catch (error) {
    sql.exec("ROLLBACK");
    throw error;
  }
  return pending.map((m) => m.name);
}
