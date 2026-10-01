// Read-only operational report. No deletion path or automatic retention is implemented.
import { DatabaseSync } from "node:sqlite";
const [path, age = "90", ...extra] = process.argv.slice(2);
const days = Number(age);
if (!path || !Number.isInteger(days) || days < 1 || days > 3650 || extra.length)
  throw new Error("Uso: node scripts/retention-report.mjs BANCO dias(1..3650)");
const db = new DatabaseSync(path, { readOnly: true });
try {
  const before = new Date(Date.now() - days * 86400000).toISOString(),
    report = { mode: "read-only", before, candidates: {} };
  for (const [table, column] of [
    ["listing_snapshots", "observed_at"],
    ["provider_runs", "started_at"],
    ["product_events", "created_at"],
  ]) {
    if (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
    )
      report.candidates[table] = db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}<?`)
        .get(before).n;
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}
