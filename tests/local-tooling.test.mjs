import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { initializeLocal, readLocalConfig } from "../scripts/local-config.mjs";
import { nodeCompatible, runDoctor } from "../scripts/doctor.mjs";

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "market-radar-test-"));
  t.after(() => {
    if (!root.startsWith(join(tmpdir(), "market-radar-test-")))
      throw new Error("Unsafe test cleanup");
    rmSync(root, { recursive: true, force: true });
  });
  copyFileSync(".env.example", join(root, ".env.example"));
  return root;
}
test("inicializador gera token em arquivo novo ou vazio e preserva valores existentes", (t) => {
  const root = temporary(t);
  initializeLocal(root);
  let config = readLocalConfig(root);
  assert.equal(config.WORKER_TOKEN.length, 64);
  assert.equal(config.BRIGHTDATA_API_KEY, "");
  const original = config.WORKER_TOKEN;
  initializeLocal(root);
  assert.equal(readLocalConfig(root).WORKER_TOKEN, original);
  writeFileSync(
    join(root, ".dev.vars"),
    "  WORKER_TOKEN=\nBRIGHTDATA_API_KEY=synthetic-fixture-key\nFACEBOOK_DATA_RIGHTS_CONFIRMED=false\n",
  );
  initializeLocal(root);
  config = readLocalConfig(root);
  assert.equal(config.WORKER_TOKEN.length, 64);
  assert.equal(config.BRIGHTDATA_API_KEY, "synthetic-fixture-key");
  assert.equal(config.FACEBOOK_DATA_RIGHTS_CONFIRMED, "false");
});
test("config local respeita precedência e mínimo Node", (t) => {
  const root = temporary(t);
  writeFileSync(join(root, ".env"), "WORKER_USER_ID=env\n");
  writeFileSync(join(root, ".dev.vars"), "WORKER_USER_ID=local\n");
  assert.equal(readLocalConfig(root).WORKER_USER_ID, "local");
  assert.equal(
    readLocalConfig(root, { WORKER_USER_ID: "explicit" }).WORKER_USER_ID,
    "explicit",
  );
  assert.equal(nodeCompatible("22.12.9", ">=22.13.0"), false);
  assert.equal(nodeCompatible("22.13.0", ">=22.13.0"), true);
  assert.equal(nodeCompatible("24.21.0", ">=22.13.0"), true);
});
test("worker rejeita token multilinha e origem inválida sem revelar secrets", (t) => {
  const root = temporary(t);
  const worker = fileURLToPath(
    new URL("../scripts/worker.mjs", import.meta.url),
  );
  const secret = "synthetic-private-worker-credential";
  for (const env of [
    {
      WORKER_TOKEN: secret + "\n" + secret,
      RADAR_API_URL: "http://localhost:5173",
    },
    { WORKER_TOKEN: secret, RADAR_API_URL: "invalid-" + secret },
  ]) {
    const result = spawnSync(process.execPath, [worker], {
      cwd: root,
      env: { ...process.env, ...env, WORKER_USER_ID: "local-radar" },
      encoding: "utf8",
      timeout: 3000,
    });
    assert.equal(result.status, 1);
    assert.ok(!(result.stdout + result.stderr).includes(secret));
  }
});
test("doctor é somente leitura, confere banco/migration e não envia secrets ou solicita provider", async (t) => {
  const root = temporary(t);
  initializeLocal(root);
  copyFileSync("package.json", join(root, "package.json"));
  for (const p of ["vinext", "vite", "wrangler", "typescript"]) {
    mkdirSync(join(root, "node_modules", p), { recursive: true });
    writeFileSync(join(root, "node_modules", p, "package.json"), "{}");
  }
  writeFileSync(join(root, ".gitignore"), ".dev.vars\n");
  assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: root }).status, 0);
  mkdirSync(join(root, "drizzle"));
  mkdirSync(join(root, ".wrangler/state/v3/d1"), { recursive: true });
  const sql = ["listings", "jobs", "provider_runs", "discovery_observations"]
    .map((n) => `CREATE TABLE ${n}(id TEXT);`)
    .join("\n");
  writeFileSync(join(root, "drizzle/0000.sql"), sql);
  writeFileSync(
    join(root, ".wrangler/radar-migrations.json"),
    JSON.stringify({
      "0000.sql": createHash("sha256").update(sql).digest("hex"),
    }),
  );
  const db = new DatabaseSync(join(root, ".wrangler/state/v3/d1/test.sqlite"));
  db.exec(sql);
  db.close();
  const before = readFileSync(join(root, ".dev.vars"), "utf8");
  let calls = 0;
  const report = await runDoctor({
    root,
    environment: {},
    transport: async (url, options) => {
      calls++;
      assert.equal(url, "http://localhost:5173/api/v1/health/live");
      assert.equal(options.headers, undefined);
      return Response.json({ status: "ok", userId: "local-radar" });
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.ok, true);
  assert.equal(
    report.rows.find((r) => r.name === "Bright Data API Key").status,
    "MISSING",
  );
  assert.ok(
    !JSON.stringify(report).includes(readLocalConfig(root).WORKER_TOKEN),
  );
  assert.equal(readFileSync(join(root, ".dev.vars"), "utf8"), before);
  writeFileSync(join(root, "drizzle/0000.sql"), sql + "\n-- changed");
  const bad = await runDoctor({
    root,
    environment: {
      RADAR_API_URL: "https://example.com",
      BRIGHTDATA_API_KEY: "synthetic-fixture-secret",
    },
    transport: async () => {
      throw new Error("Must not fetch remote");
    },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.rows.find((r) => r.name === "Local API").status, "SKIPPED");
  assert.ok(!JSON.stringify(bad).includes("synthetic-fixture-secret"));
});
