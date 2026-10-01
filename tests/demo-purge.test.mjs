import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { purgeDemo } from "../scripts/demo-purge.mjs";
test("purge usa proveniência concordante; preserva real, conflitos e orçamento; é idempotente", () => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync("drizzle/" + f, "utf8"));
  db.exec("INSERT INTO users VALUES ('u','now','{}',1)");
  const listing = (id, demo, data) =>
    db
      .prepare(
        "INSERT INTO listings (id,user_id,marketplace,external_id,url,product_key,fingerprint,demo,data,price,first_seen_at,last_seen_at) VALUES (?,'u','facebook',?,?,NULL,?,?,?,100,'then','now')",
      )
      .run(
        id,
        id,
        "https://www.facebook.com/marketplace/item/" + id,
        id,
        demo,
        JSON.stringify(data),
      );
  listing("real", 0, { demo: false, provider: "brightdata" });
  listing("demo", 1, { demo: true, provider: "demo" });
  listing("conflict", 1, { demo: false, provider: "brightdata" });
  for (const id of ["real", "demo", "conflict"]) {
    db.prepare(
      "INSERT INTO monitors (id,user_id,config,active,created_at) VALUES (?,'u',?,1,'now')",
    ).run(
      id,
      JSON.stringify({ provider: id === "real" ? "brightdata" : "demo" }),
    );
    db.prepare(
      "INSERT INTO monitor_sightings VALUES (?,'u',?,'demo',1,?,1,'now')",
    ).run(id, id, id);
    db.prepare("INSERT INTO purchases VALUES (?,'u',?,?)").run(
      id,
      id,
      JSON.stringify({ paid: 100 }),
    );
  }
  db.exec("INSERT INTO rate_limits VALUES ('budget:brightdata',0,3)");
  const report = purgeDemo(db);
  assert.equal(report.removedListings, 1);
  assert.equal(report.removedMonitors, 1);
  assert.equal(report.realAfter, 1);
  assert.ok(db.prepare("SELECT id FROM listings WHERE id='conflict'").get());
  assert.ok(db.prepare("SELECT id FROM monitors WHERE id='conflict'").get());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM purchases").get().n, 2);
  assert.equal(db.prepare("SELECT count FROM rate_limits").get().count, 3);
  assert.equal(purgeDemo(db).removedListings, 0);
  db.close();
});
