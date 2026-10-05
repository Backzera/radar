import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeDatabase, migrate } from "../server/node-runtime/d1";
import { createFileMedia } from "../server/node-runtime/media";
import { createHandler } from "../server/http";
import type { Database } from "../server/store";

const open: { close(): void }[] = [];
function temporary(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "brique-vps-"));
  // Windows keeps an open SQLite file locked: close databases before removing.
  t.after(() => {
    for (const db of open.splice(0)) db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
const database = (file: string) => {
  const db = createNodeDatabase(file);
  open.push(db);
  return db;
};
function migrationsCopy(dir: string) {
  const target = join(dir, "drizzle");
  mkdirSync(target);
  for (const f of readdirSync("drizzle").filter((f) => f.endsWith(".sql")))
    copyFileSync(join("drizzle", f), join(target, f));
  return target;
}

test("vps: banco em arquivo aplica todas as migrations uma vez e recusa migration alterada", (t) => {
  const dir = temporary(t);
  const migrations = migrationsCopy(dir);
  const db = database(join(dir, "data", "brique.sqlite"));
  const applied = migrate(db, migrations, join(dir, "backups"));
  assert.ok(applied.includes("0000_certain_zarda.sql"));
  assert.ok(applied.includes("0008_user_admin.sql"));
  assert.deepEqual(migrate(db, migrations, join(dir, "backups")), []);
  const fk = db.sql.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
  assert.equal(fk.foreign_keys, 1);
  writeFileSync(join(migrations, "0008_user_admin.sql"), "-- alterada\n");
  assert.throws(() => migrate(db, migrations, join(dir, "backups")), /mudou depois de aplicada/);
});

test("vps: migration nova em banco existente faz backup antes", (t) => {
  const dir = temporary(t);
  const migrations = migrationsCopy(dir);
  const db = database(join(dir, "brique.sqlite"));
  migrate(db, migrations, join(dir, "backups"));
  writeFileSync(join(migrations, "0099_extra.sql"), "CREATE TABLE extra (id TEXT PRIMARY KEY);");
  assert.deepEqual(migrate(db, migrations, join(dir, "backups")), ["0099_extra.sql"]);
  assert.equal(readdirSync(join(dir, "backups")).length, 1);
});

test("vps: comandos no formato D1 (first, all, run, batch com rollback)", async (t) => {
  const dir = temporary(t);
  const db = database(join(dir, "x.sqlite"));
  db.sql.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL)");
  const run = await db.prepare("INSERT INTO t (id,n) VALUES (?,?)").bind("a", 1).run();
  assert.equal(run.meta.changes, 1);
  assert.deepEqual(await db.prepare("SELECT n FROM t WHERE id=?").bind("a").first(), { n: 1 });
  assert.equal(await db.prepare("SELECT n FROM t WHERE id=?").bind("a").first("n"), 1);
  assert.equal(await db.prepare("SELECT n FROM t WHERE id=?").bind("zz").first(), null);
  const insert = db.prepare("INSERT INTO t (id,n) VALUES (?,?)");
  await assert.rejects(db.batch([insert.bind("b", 2), insert.bind("a", 3)]));
  const { results } = await db.prepare("SELECT id FROM t ORDER BY id").all<{ id: string }>();
  assert.deepEqual(results.map((r) => r.id), ["a"]);
  const returning = await db
    .prepare("UPDATE t SET n=n+1 WHERE id=? RETURNING n")
    .bind("a")
    .first<{ n: number }>();
  assert.equal(returning?.n, 2);
});

test("vps: fotos ficam na pasta e uma chave com ../ não sai dela", async (t) => {
  const dir = temporary(t);
  const media = createFileMedia(join(dir, "media"));
  await media.put("brick/u/i/p.png", new Uint8Array([1, 2, 3]).buffer);
  const object = await media.get("brick/u/i/p.png");
  assert.deepEqual(new Uint8Array(await new Response(object!.body).arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal(await media.get("brick/u/i/outra.png"), null);
  await assert.rejects(media.put("../fora.png", new Uint8Array([1]).buffer), /inválida/);
  await media.delete("brick/u/i/p.png");
  assert.equal(await media.get("brick/u/i/p.png"), null);
});

test("vps: API sob /brique atrás do proxy usa a origem pública e cookie restrito ao prefixo", async (t) => {
  const dir = temporary(t);
  const db = database(join(dir, "brique.sqlite"));
  migrate(db, migrationsCopy(dir), join(dir, "backups"));
  const handler = createHandler(db as unknown as Database, {
    AUTH_MODE: "password",
    APP_ORIGIN: "https://dz7.online",
    BASE_PATH: "/brique",
  }, { media: createFileMedia(join(dir, "media")) });
  // What the Node server receives from nginx: plain http on the loopback.
  const call = (path: string, init: RequestInit & { origin?: string } = {}) =>
    handler(
      new Request(`http://127.0.0.1:3000/brique/api/v1/${path}`, {
        ...init,
        headers: {
          origin: init.origin ?? "https://dz7.online",
          "content-type": "application/json",
          ...(init.headers as Record<string, string>),
        },
      }),
    );
  const body = JSON.stringify({
    name: "Dono",
    email: "dono@dz7.online",
    password: "senha-forte-123",
    acceptTerms: true,
  });
  const forged = await call("auth/signup", { method: "POST", body, origin: "http://127.0.0.1:3000" });
  assert.equal(forged.status, 403);
  const signup = await call("auth/signup", { method: "POST", body });
  assert.equal(signup.status, 201);
  const cookie = signup.headers.get("set-cookie")!;
  assert.match(cookie, /Path=\/brique;/);
  assert.match(cookie, /; Secure$/);
  const session = cookie.split(";")[0];
  const items = await call("inventory", { headers: { cookie: session } });
  assert.equal(items.status, 200);
  assert.equal((await call("health/live")).status, 200);
});
