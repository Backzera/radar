import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { devPlan, waitForApi, runLocalDev } from "../scripts/dev-local.mjs";
import { workerJobLogs } from "../scripts/worker-log.mjs";

const token = "synthetic-local-test-token-".repeat(3);

test("hotfix launcher: loopback apenas; não altera auth, piloto, cotas ou credenciais", () => {
  const config = {
    RADAR_API_URL: "http://localhost:5173",
    WORKER_TOKEN: token,
    PILOT_MODE: "true",
    COLLECTION_ENABLED: "false",
  };
  const before = JSON.stringify(config),
    plan = devPlan(config);
  assert.equal(plan.port, 5173);
  assert.equal(plan.host, "127.0.0.1");
  assert.equal(plan.origin, "http://127.0.0.1:5173");
  assert.equal(plan.workerEnabled, true);
  assert.equal(JSON.stringify(config), before);
  for (const url of [
    "https://example.com",
    "http://0.0.0.0:5173",
    "http://user:pass@localhost:5173",
    "http://localhost:0",
    "http://localhost:5173/path",
    "http://localhost:5173/?token=private",
  ]) {
    assert.throws(() => devPlan({ ...config, RADAR_API_URL: url }));
  }
  for (const args of [
    ["--hostname=0.0.0.0"],
    ["-H", "0.0.0.0"],
    ["--port", "9999"],
  ])
    assert.throws(() => devPlan(config, args));
  assert.equal(devPlan({ ...config, WORKER_TOKEN: "" }).workerEnabled, false);
  assert.equal(
    devPlan({ ...config, LOCAL_WORKER_AUTOSTART: "false" }).workerEnabled,
    false,
  );
});

test("hotfix launcher: argumentos correspondem ao parser real do Vinext instalado", async () => {
  const { parseArgs } = await import("../node_modules/vinext/dist/cli-args.js");
  const plan = devPlan({
    RADAR_API_URL: "http://127.0.0.1:5199",
    WORKER_TOKEN: token,
  });
  const parsed = parseArgs([
    "--port",
    "5173",
    "--hostname",
    plan.host,
    "--port",
    String(plan.port),
  ]);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.equal(parsed.port, 5199);
});

test("hotfix launcher: aguarda readiness e não inicia por um HTTP 200 genérico", async () => {
  let calls = 0;
  const ready = await waitForApi("http://127.0.0.1:5173", {
    intervalMs: 1,
    timeoutMs: 1000,
    fetcher: async (url, opts) => {
      assert.equal(url, "http://127.0.0.1:5173/api/v1/health/ready");
      assert.equal(opts.redirect, "error");
      assert.equal(opts.headers, undefined);
      return calls++ === 0
        ? Response.json({ status: "other" })
        : Response.json({ status: "ready" });
    },
  });
  assert.equal(ready, true);
  assert.equal(calls, 2);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    await waitForApi("http://127.0.0.1:5173", {
      signal: controller.signal,
      fetcher: () => {
        throw new Error("must not fetch");
      },
    }),
    false,
  );
});

test("hotfix worker: log inclui erro do job aninhado, sem payload/segredos; suporta resposta antiga", () => {
  const result = {
    status: "processed",
    queued: 0,
    results: [
      {
        status: "dead",
        jobId: "job-fixture",
        phase: "preflight",
        received: null,
        error: `Informe city. Bearer ${token} api_key=private-data http://secret.example/path`,
        payload: { WORKER_TOKEN: token },
        userId: "private-user",
      },
    ],
  };
  const entries = workerJobLogs(result, [token]);
  assert.equal(entries[0].event, "worker_job_error");
  assert.match(entries[0].error, /Informe city/);
  assert.equal(entries[0].phase, "preflight");
  const text = JSON.stringify(entries);
  for (const value of [
    token,
    "private-data",
    "secret.example",
    "private-user",
    "payload",
  ])
    assert.equal(text.includes(value), false);
  assert.equal(workerJobLogs({ status: "idle", results: [] }).length, 0);
  assert.equal(
    workerJobLogs({
      status: "waiting",
      jobId: "legacy-job",
      snapshotId: "sd_legacy",
    })[0].snapshotId,
    "sd_legacy",
  );
});

test("hotfix launcher: porta ocupada é recusada sem tocar no servidor existente", async () => {
  const server = createServer((req, res) => res.end("still running"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  try {
    await assert.rejects(
      runLocalDev({
        config: {
          RADAR_API_URL: `http://127.0.0.1:${port}`,
          WORKER_TOKEN: token,
        },
      }),
      /em uso/,
    );
    assert.equal(
      await (await fetch(`http://127.0.0.1:${port}`)).text(),
      "still running",
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test(
  "hotfix launcher: um comando inicia dois filhos locais e SIGTERM encerra somente esses filhos",
  { timeout: 15000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "radar-hotfix-launch-"));
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const origin = `http://127.0.0.1:${port}`;
    const configText = `WORKER_TOKEN=${token}\nRADAR_API_URL=${origin}\nWORKER_TICK_MS=5000\nPILOT_MODE=true\nCOLLECTION_ENABLED=false\n`;
    writeFileSync(join(root, ".dev.vars"), configText);
    const framework = join(root, "server-fixture.mjs");
    writeFileSync(
      framework,
      `import { createServer } from 'node:http';
const s=createServer((req,res)=>{ res.setHeader('Content-Type','application/json');
if(req.url==='/api/v1/health/ready')res.end(JSON.stringify({status:'ready'}));
else if(req.url==='/api/v1/worker/tick' && req.method==='POST')res.end(JSON.stringify({status:'processed',queued:0,accounts:1,results:[{status:'waiting',jobId:'local-fixture-job',snapshotId:'sd_local_fixture'}]}));
else{res.statusCode=404;res.end('{}');}});s.listen(${port},'127.0.0.1');
process.once('SIGTERM',()=>s.close(()=>process.exit(0)));`,
    );
    const launcher = pathToFileURL(resolve("scripts/dev-local.mjs")).href;
    const worker = resolve("scripts/worker.mjs");
    writeFileSync(
      join(root, "entry.mjs"),
      `import {runLocalDev} from ${JSON.stringify(launcher)};
const r=await runLocalDev({root:${JSON.stringify(root)},framework:${JSON.stringify(framework)},worker:${JSON.stringify(worker)},readinessTimeout:5000});
console.log('CHILD_PIDS='+JSON.stringify([r.server.pid,r.worker?.pid]));`,
    );
    const child = spawn(process.execPath, [join(root, "entry.mjs")], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let output = "";
    const append = (c) => {
      output += c.toString();
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let pids = [];
    t.after(async () => {
      if (child.exitCode === null && !child.signalCode) child.kill("SIGTERM");
      rmSync(root, { recursive: true, force: true });
    });
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline && !output.includes('"event":"worker_job"'))
      await delay(30);
    assert.match(output, /Worker iniciado nesta janela/);
    assert.match(output, /"event":"worker_started"/);
    assert.match(output, /"snapshotId":"sd_local_fixture"/);
    assert.equal(output.includes(token), false);
    pids = JSON.parse(output.match(/CHILD_PIDS=(\[[^\n]+\])/)[1]);
    assert.equal(pids.length, 2);
    assert.ok(pids.every(Number.isInteger));
    assert.equal(readFileSync(join(root, ".dev.vars"), "utf8"), configText);
    const closed = once(child, "exit");
    child.kill("SIGTERM");
    await closed;
    await delay(150);
    for (const pid of pids) assert.throws(() => process.kill(pid, 0));
  },
);
