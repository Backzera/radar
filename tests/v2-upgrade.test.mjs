import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { upgradeLocal } from "../scripts/upgrade-local.mjs";
import { copyDatabase } from "../scripts/backup.mjs";
const digest = (b) => createHash("sha256").update(b).digest("hex");
function setup() {
  const root = mkdtempSync(join(tmpdir(), "radar-upgrade-"));
  mkdirSync(join(root, "drizzle"));
  mkdirSync(join(root, ".wrangler/state/d1"), { recursive: true });
  const filename = join(root, ".wrangler/state/d1/radar.sqlite"),
    db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  const journal = {};
  for (const f of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const content = readFileSync(join("drizzle", f));
    writeFileSync(join(root, "drizzle", f), content);
    if (f < "0006") {
      db.exec(content.toString());
      journal[f] = digest(content);
    }
  }
  db.prepare(
    "INSERT INTO users(id,created_at,settings) VALUES('owner','2026-09-01','{}')",
  ).run();
  db.prepare(
    "INSERT INTO monitors(id,user_id,config,active,created_at) VALUES('m','owner',?,1,'2026-09-01')",
  ).run(
    JSON.stringify({
      city: "Curitiba",
      maxPrice: 2200,
      latitude: -25.4,
      aliases: ["Apple iPhone 14"],
    }),
  );
  writeFileSync(
    join(root, ".wrangler/radar-migrations.json"),
    JSON.stringify(journal),
  );
  const vars =
    "PILOT_MODE=true\nCOLLECTION_ENABLED=false\nWORKER_TOKEN=synthetic-test-only\n";
  writeFileSync(join(root, ".dev.vars"), vars);
  return {
    root,
    filename,
    db,
    vars,
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("2.0 upgrade: backup WAL, migration aditiva, configuração preservada e segunda execução idempotente", async () => {
  const f = setup();
  try {
    const before = f.db.prepare("SELECT * FROM monitors").all();
    const upgraded = await upgradeLocal(f.root);
    assert.equal(upgraded.status, "upgraded");
    assert.ok(existsSync(upgraded.backup));
    assert.deepEqual(f.db.prepare("SELECT * FROM monitors").all(), before);
    assert.equal(readFileSync(join(f.root, ".dev.vars"), "utf8"), f.vars);
    for (const name of [
      "deal_pipeline",
      "radar_activations",
      "availability_checks",
    ])
      assert.ok(
        f.db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(name),
      );
    assert.equal(
      f.db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal((await upgradeLocal(f.root)).status, "current");
    const destination = join(f.root, "restore.sqlite");
    await copyDatabase(upgraded.backup, destination, { restore: true });
    const old = new DatabaseSync(destination);
    try {
      assert.deepEqual(old.prepare("SELECT * FROM monitors").all(), before);
      assert.equal(
        old
          .prepare("SELECT name FROM sqlite_master WHERE name='deal_pipeline'")
          .get(),
        undefined,
      );
    } finally {
      old.close();
    }
  } finally {
    f.close();
  }
});
test("2.0 upgrade: recusa migration histórica modificada antes de alterar o banco", async () => {
  const f = setup();
  try {
    writeFileSync(join(f.root, "drizzle/0000_certain_zarda.sql"), "-- altered");
    await assert.rejects(
      upgradeLocal(f.root),
      /Migration previamente aplicada/,
    );
    assert.equal(
      f.db
        .prepare("SELECT name FROM sqlite_master WHERE name='deal_pipeline'")
        .get(),
      undefined,
    );
    assert.equal(existsSync(join(f.root, "backups")), false);
  } finally {
    f.close();
  }
});
test("2.0 upgrade: falha SQL reverte toda alteração e mantém backup verificável", async () => {
  const f = setup();
  try {
    writeFileSync(
      join(f.root, "drizzle/0006_radar_experience.sql"),
      "CREATE TABLE should_rollback(id); THIS IS INVALID SQL;",
    );
    await assert.rejects(upgradeLocal(f.root));
    assert.equal(
      f.db
        .prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'")
        .get(),
      undefined,
    );
    assert.equal(
      readdirSync(join(f.root, "backups")).filter((f) => f.endsWith(".sqlite"))
        .length,
      1,
    );
    assert.equal(
      JSON.parse(
        readFileSync(join(f.root, ".wrangler/radar-migrations.json"), "utf8"),
      )["0006_radar_experience.sql"],
      undefined,
    );
  } finally {
    f.close();
  }
});
test("2.0 upgrade: recusa escolher arbitrariamente entre dois bancos", async () => {
  const f = setup();
  try {
    await copyDatabase(
      f.filename,
      join(f.root, ".wrangler/state/d1/second.sqlite"),
    );
    await assert.rejects(upgradeLocal(f.root), /Mais de um banco/);
    assert.equal(
      f.db
        .prepare("SELECT name FROM sqlite_master WHERE name='deal_pipeline'")
        .get(),
      undefined,
    );
  } finally {
    f.close();
  }
});
