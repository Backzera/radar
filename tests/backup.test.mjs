import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { copyDatabase } from "../scripts/backup.mjs";
test("backup inclui WAL confirmado; restaura em outro arquivo, preserva origem e recusa sobrescrita", async () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-backup-"));
  let db;
  try {
    const source = join(dir, "source.sqlite"),
      dest = join(dir, "backup.sqlite"),
      restored = join(dir, "restored.sqlite");
    db = new DatabaseSync(source);
    db.exec(
      'PRAGMA journal_mode=WAL;CREATE TABLE records(id TEXT PRIMARY KEY,value INTEGER);INSERT INTO records VALUES ("fixture",7)'.replace(
        '"fixture"',
        "'fixture'",
      ),
    );
    await copyDatabase(source, dest);
    const copied = new DatabaseSync(dest, { readOnly: true });
    assert.equal(copied.prepare("SELECT value FROM records").get().value, 7);
    copied.close();
    const hash = (p) =>
        createHash("sha256").update(readFileSync(p)).digest("hex"),
      before = hash(dest);
    await assert.rejects(copyDatabase(source, dest), /novo/);
    assert.equal(hash(dest), before);
    await copyDatabase(dest, restored, { restore: true });
    const result = new DatabaseSync(restored, { readOnly: true });
    assert.equal(result.prepare("SELECT value FROM records").get().value, 7);
    result.close();
    const m = JSON.parse(readFileSync(dest + ".manifest.json"));
    m.sha256 = "wrong";
    writeFileSync(dest + ".manifest.json", JSON.stringify(m));
    await assert.rejects(
      copyDatabase(dest, join(dir, "bad.sqlite"), { restore: true }),
      /Hash/,
    );
    assert.equal(db.prepare("SELECT value FROM records").get().value, 7);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
