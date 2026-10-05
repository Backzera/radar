/**
 * Stand-in for `cloudflare:workers` in the self-hosted (Node) build: the same
 * `env` object the Workers runtime gives, built from process.env plus a SQLite
 * file for DB and a folder for MEDIA. vite.config.ts aliases the module.
 */
import { join, resolve } from "node:path";
import { createNodeDatabase, migrate, type NodeDatabase } from "./d1";
import { createFileMedia } from "./media";

const dataDir = resolve(process.env.DATA_DIR ?? "data");
let database: NodeDatabase | undefined;
let media: ReturnType<typeof createFileMedia> | undefined;

// Opened on first use (the health check does it right after start). Opening is
// synchronous, so two first requests cannot both run the migrations.
function openDatabase() {
  if (database) return database;
  const db = createNodeDatabase(join(dataDir, "brique.sqlite"));
  const applied = migrate(
    db,
    resolve(process.env.MIGRATIONS_DIR ?? "drizzle"),
    join(dataDir, "backups"),
  );
  if (applied.length)
    console.info(JSON.stringify({ event: "migrations_applied", applied }));
  database = db;
  return db;
}

function read(key: string | symbol) {
  if (key === "DB") return openDatabase();
  if (key === "MEDIA") return (media ??= createFileMedia(join(dataDir, "media")));
  return typeof key === "string" ? process.env[key] : undefined;
}

export const env = new Proxy({} as Record<string, unknown>, {
  get: (_, key) => read(key),
  has: (_, key) =>
    key === "DB" || key === "MEDIA" || (typeof key === "string" && key in process.env),
  ownKeys: () => [...Object.keys(process.env), "DB", "MEDIA"],
  getOwnPropertyDescriptor: (_, key) => ({
    enumerable: true,
    configurable: true,
    writable: false,
    value: read(key),
  }),
});
