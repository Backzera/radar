import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
test("Snapshot Drizzle mais recente descreve exatamente tabelas e colunas das migrations SQL", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const f of readdirSync("drizzle")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      db.exec(readFileSync("drizzle/" + f, "utf8"));
    const snapshot = JSON.parse(
      readFileSync(
        "drizzle/meta/" +
          readdirSync("drizzle/meta")
            .filter((f) => f.endsWith("_snapshot.json"))
            .sort()
            .at(-1),
        "utf8",
      ),
    );
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    assert.deepEqual(tables, Object.keys(snapshot.tables).sort());
    for (const name of tables) {
      const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
      assert.deepEqual(
        cols.map((c) => c.name).sort(),
        Object.keys(snapshot.tables[name].columns).sort(),
        name,
      );
      for (const c of cols) {
        const descriptor = snapshot.tables[name].columns[c.name];
        assert.equal(
          descriptor.type.toUpperCase(),
          c.type.toUpperCase(),
          `${name}.${c.name}`,
        );
      }
    }
  } finally {
    db.close();
  }
});
