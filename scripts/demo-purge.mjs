import { DatabaseSync, backup } from "node:sqlite";
import {
  existsSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      )
    : [];
export function provenance(db) {
  // Positive, concordant provenance only. Conflicting provenance is retained.
  return {
    listings: db
      .prepare(
        "SELECT id,user_id FROM listings WHERE demo=1 AND json_extract(data,'$.demo')=1 AND json_extract(data,'$.provider')='demo'",
      )
      .all(),
    monitors: db
      .prepare(
        "SELECT id,user_id FROM monitors WHERE json_extract(config,'$.provider')='demo'",
      )
      .all(),
    real: db.prepare("SELECT COUNT(*) AS n FROM listings WHERE demo=0").get().n,
  };
}
function realDigest(db) {
  const tables = [
    "listings",
    "listing_snapshots",
    "alerts",
    "purchases",
    "feedback",
    "opportunities",
    "monitor_sightings",
    "discovery_observations",
  ];
  const records = tables.map((t) => [
    t,
    db
      .prepare(
        `SELECT * FROM ${t} WHERE ${t === "listings" ? "demo=0" : "listing_id IN (SELECT id FROM listings WHERE demo=0)"} ORDER BY id`,
      )
      .all(),
  ]);
  for (const t of ["users", "rate_limits", "discovery_candidates"])
    records.push([t, db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]);
  for (const t of [
    "monitors",
    "monitor_scopes",
    "provider_health",
    "provider_runs",
  ])
    records.push([
      t,
      db
        .prepare(
          `SELECT * FROM ${t} WHERE ${t === "monitors" ? "COALESCE(json_extract(config,'$.provider'),'')!='demo'" : "provider!='demo'"} ORDER BY id`,
        )
        .all(),
    ]);
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}
function protectedDigest(db) {
  const rules = {
    listings: "id NOT IN (SELECT id FROM purge_listings)",
    listing_snapshots: "listing_id NOT IN (SELECT id FROM purge_listings)",
    alerts: "listing_id NOT IN (SELECT id FROM purge_listings)",
    purchases: "listing_id NOT IN (SELECT id FROM purge_listings)",
    feedback: "listing_id NOT IN (SELECT id FROM purge_listings)",
    opportunities: "listing_id NOT IN (SELECT id FROM purge_listings)",
    monitor_sightings: "listing_id NOT IN (SELECT id FROM purge_listings)",
    discovery_observations: "listing_id NOT IN (SELECT id FROM purge_listings)",
    monitors: "id NOT IN (SELECT id FROM purge_monitors)",
    monitor_scopes:
      "provider!='demo' OR monitor_id NOT IN (SELECT id FROM purge_monitors)",
    jobs: "id NOT IN (SELECT id FROM purge_jobs)",
    search_queries: "monitor_id NOT IN (SELECT id FROM purge_monitors)",
    notification_outbox: "id NOT IN (SELECT id FROM purge_outbox)",
    provider_health: "provider!='demo'",
    provider_runs: "provider!='demo'",
    users: "1=1",
    rate_limits: "1=1",
    discovery_candidates: "1=1",
  };
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(rules).map(([t, where]) => [
          t,
          db.prepare(`SELECT * FROM ${t} WHERE ${where} ORDER BY 1`).all(),
        ]),
      ),
    )
    .digest("hex");
}
export function purgeDemo(db) {
  db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  try {
    const before = provenance(db),
      digest = realDigest(db);
    db.exec(
      "CREATE TEMP TABLE purge_listings AS SELECT id,user_id FROM listings WHERE demo=1 AND json_extract(data,'$.demo')=1 AND json_extract(data,'$.provider')='demo'; CREATE TEMP TABLE purge_monitors AS SELECT id,user_id FROM monitors WHERE json_extract(config,'$.provider')='demo';",
    );
    db.exec(
      "DELETE FROM purge_monitors WHERE id IN (SELECT monitor_id FROM monitor_sightings WHERE listing_id NOT IN (SELECT id FROM purge_listings)) OR id IN (SELECT monitor_id FROM provider_runs WHERE provider!='demo') OR id IN (SELECT monitor_id FROM monitor_scopes WHERE provider!='demo') OR id IN (SELECT monitor_id FROM opportunities WHERE listing_id NOT IN (SELECT id FROM purge_listings)) OR id IN (SELECT monitor_id FROM discovery_observations WHERE listing_id NOT IN (SELECT id FROM purge_listings)) OR id IN (SELECT monitor_id FROM monitor_scopes WHERE id IN (SELECT scope_id FROM discovery_candidates)); CREATE TEMP TABLE purge_jobs AS SELECT id FROM jobs WHERE scope_id IN (SELECT id FROM monitor_scopes WHERE provider='demo' AND monitor_id IN (SELECT id FROM purge_monitors)); CREATE TEMP TABLE purge_outbox AS SELECT id FROM notification_outbox WHERE alert_id IN (SELECT id FROM alerts WHERE listing_id IN (SELECT id FROM purge_listings));",
    );
    const protectedBefore = protectedDigest(db);
    const listing = "listing_id IN (SELECT id FROM purge_listings)";
    db.exec(
      `DELETE FROM notification_outbox WHERE alert_id IN (SELECT id FROM alerts WHERE ${listing});`,
    );
    for (const t of [
      "alerts",
      "listing_snapshots",
      "purchases",
      "feedback",
      "opportunities",
      "monitor_sightings",
      "discovery_observations",
    ])
      db.exec(`DELETE FROM ${t} WHERE ${listing}`);
    // A monitor with any real history is retained instead of deleting uncertain links.
    db.exec(
      "DELETE FROM purge_monitors WHERE id IN (SELECT monitor_id FROM monitor_sightings WHERE listing_id IN (SELECT id FROM listings WHERE demo=0)) OR id IN (SELECT monitor_id FROM provider_runs WHERE provider!='demo') OR id IN (SELECT monitor_id FROM monitor_scopes WHERE provider!='demo') OR id IN (SELECT monitor_id FROM opportunities WHERE listing_id IN (SELECT id FROM listings WHERE demo=0))",
    );
    db.exec(
      "DELETE FROM jobs WHERE scope_id IN (SELECT id FROM monitor_scopes WHERE provider='demo' AND monitor_id IN (SELECT id FROM purge_monitors)); DELETE FROM search_queries WHERE monitor_id IN (SELECT id FROM purge_monitors); DELETE FROM monitor_scopes WHERE provider='demo' AND monitor_id IN (SELECT id FROM purge_monitors); DELETE FROM monitors WHERE id IN (SELECT id FROM purge_monitors); DELETE FROM listings WHERE id IN (SELECT id FROM purge_listings); DELETE FROM provider_health WHERE provider='demo'; DELETE FROM provider_runs WHERE provider='demo';",
    );
    if (realDigest(db) !== digest)
      throw new Error(
        "Preservação dos dados reais falhou; rollback automático.",
      );
    if (protectedDigest(db) !== protectedBefore)
      throw new Error("Registro não autorizado mudou; rollback automático.");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Integridade referencial falhou; rollback.");
    const after = provenance(db);
    db.exec(
      "DROP TABLE purge_listings; DROP TABLE purge_monitors; DROP TABLE purge_jobs; DROP TABLE purge_outbox; COMMIT",
    );
    return {
      removedListings: before.listings.length - after.listings.length,
      removedMonitors: before.monitors.length - after.monitors.length,
      realBefore: before.real,
      realAfter: after.real,
      preservedDigest: digest,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export async function runPurge(root = process.cwd(), apply = false) {
  const files = walk(join(root, ".wrangler/state/v3/d1")).filter((p) =>
    p.endsWith(".sqlite"),
  );
  const matching = files.filter((p) => {
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      return !!db
        .prepare("SELECT name FROM sqlite_master WHERE name='listings'")
        .get();
    } finally {
      db.close();
    }
  });
  if (matching.length !== 1)
    throw new Error(
      "Esperado exatamente um banco local MARKET RADAR; nenhum banco alterado.",
    );
  const db = new DatabaseSync(matching[0]);
  db.exec("PRAGMA busy_timeout=10000");
  try {
    const p = provenance(db);
    console.log(
      JSON.stringify({
        mode: apply ? "apply" : "preview",
        demoListings: p.listings.length,
        demoMonitors: p.monitors.length,
        realListings: p.real,
      }),
    );
    if (!apply) {
      console.log("Para aplicar com backup: npm run demo:purge -- --apply");
      return;
    }
    const dir = join(
      root,
      ".wrangler/backups",
      `before-demo-purge-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "radar.sqlite");
    await backup(db, file); // SQLite backup API includes committed WAL; consistent online copy.
    const copy = new DatabaseSync(file, { readOnly: true });
    try {
      if (
        copy.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
        realDigest(copy) !== realDigest(db)
      )
        throw new Error("Backup não confirmado; banco original preservado.");
    } finally {
      copy.close();
    }
    if (existsSync(join(root, ".wrangler/radar-migrations.json")))
      copyFileSync(
        join(root, ".wrangler/radar-migrations.json"),
        join(dir, "radar-migrations.json"),
      );
    const report = purgeDemo(db);
    writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        ...report,
        backup: `.wrangler/backups/${dir.split(/[\\/]/).at(-1)}/radar.sqlite`,
      }),
    );
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await runPurge(process.cwd(), process.argv.includes("--apply"));
