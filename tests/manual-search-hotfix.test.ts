import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { database } from "./fixtures";
import { createHandler } from "../server/http";
import { BrightDataProvider } from "../providers/brightdata";
import { getMonitors } from "../server/store";

// Synthetic supplement for successful integration scenarios, NOT evidence of
// the account's actual options/units. Missing metadata is tested separately.
function confirmedTestMetadata() {
  const metadata = JSON.parse(
    readFileSync("tests/fixtures/brightdata-metadata-2026-09-12.json", "utf8"),
  );
  const fields = metadata[0].scrapers.discover_by_keyword.input_schema;
  fields.find((f: { name: string }) => f.name === "radius").unit = "km";
  fields.find((f: { name: string }) => f.name === "date_listed").enum = [
    "Last 24 hours",
    "Last 7 days",
  ];
  return metadata;
}
const cfg = {
  AUTH_MODE: "local-development",
  ALLOW_LOCAL_DEV_AUTH: "true",
  RADAR_ADMIN_IDS: "local-radar",
  COLLECTION_ENABLED: "true",
  PILOT_MODE: "true",
  BRIGHTDATA_API_KEY: "synthetic-key-not-live",
  FACEBOOK_DATA_RIGHTS_CONFIRMED: "true",
  BRIGHTDATA_DATASET_ID: "gd_lvt9iwuh6fbcwmx1a",
  WORKER_TOKEN: "test-worker-token-".repeat(4),
};
const request = (path: string, data?: unknown) =>
  new Request(`http://localhost:5173/api/v1/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      origin: "http://localhost:5173",
      "content-type": "application/json",
      ...(path === "worker/tick"
        ? { authorization: `Bearer ${cfg.WORKER_TOKEN}` }
        : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
function transportFixture() {
  const calls: { path: string; body: unknown }[] = [];
  let progress = "ready";
  const transport = (async (input, init) => {
    const u = new URL(String(input));
    calls.push({
      path: u.pathname + u.search,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (u.pathname.endsWith("/scrapers"))
      return Response.json(confirmedTestMetadata());
    if (u.pathname.endsWith("/trigger"))
      return Response.json({ snapshot_id: "sd_hotfix_fixture" });
    if (u.pathname.includes("/progress/"))
      return Response.json({
        status: progress,
        snapshot_id: "sd_hotfix_fixture",
        dataset_id: cfg.BRIGHTDATA_DATASET_ID,
      });
    if (u.pathname.includes("/snapshot/"))
      return Response.json([
        {
          product_id: "112233",
          url: "https://www.facebook.com/marketplace/item/112233/",
          title: "iPhone 14 128 GB usado",
          description:
            "Funcionando, aparelho completo. Sem bloqueio de iCloud.",
          final_price: 2000,
          currency: "BRL",
          country_code: "BR",
          location: "Curitiba, Paraná, Brazil",
          listing_date: new Date().toISOString(),
          condition: "used",
          images: [],
        },
      ]);
    throw new Error(`Unexpected mock route: ${u.pathname}`);
  }) as typeof fetch;
  return {
    calls,
    transport,
    setProgress: (p: string) => {
      progress = p;
    },
  };
}

test("hotfix: busca salva ANTES da validação leva a cidade ao trigger e conclui baseline no feed", async () => {
  const { db, sql } = database();
  const mock = transportFixture();
  const handler = createHandler(db, cfg, {
    development: true,
    provider: () =>
      new BrightDataProvider(
        {
          apiKey: cfg.BRIGHTDATA_API_KEY,
          rightsConfirmed: "true",
          dataset: cfg.BRIGHTDATA_DATASET_ID,
        },
        mock.transport,
      ),
  });
  try {
    // Same order shown by the user: create the monitor, then enable/validate the provider.
    const saved = await handler(
      request("searches", {
        requestKey: crypto.randomUUID(),
        config: {
          name: "iPhone 14",
          query: "iPhone 14",
          product: "iPhone 14",
          city: "Curitiba",
          intent: "personal",
          maxPrice: 2200,
          intervalSeconds: 300,
          resultsPerSearch: 10,
        },
      }),
    );
    assert.equal(saved.status, 201);
    const m = (await getMonitors(db, "local-radar"))[0];
    assert.deepEqual(m.providerFilters, {});
    assert.equal(
      (await handler(request("admin/provider/check", {}))).status,
      200,
    );
    const scan = await handler(
      request("scan", { monitorId: m.id, confirmConsumption: true }),
    );
    assert.equal(scan.status, 202);
    assert.equal((await handler(request("worker/tick", {}))).status, 200);
    const run = sql
      .prepare(
        "SELECT status,errors FROM provider_runs ORDER BY started_at DESC",
      )
      .get()!;
    assert.equal(run.status, "waiting", `Run: ${JSON.stringify(run)}`);
    const triggers = mock.calls.filter((c) => c.path.includes("/trigger?"));
    assert.equal(triggers.length, 1);
    assert.equal((triggers[0].body as { city: string }[])[0].city, "Curitiba");
    // Simulate time passage, not another paid trigger.
    sql.prepare("UPDATE jobs SET available_at='2000-01-01'").run();
    assert.equal((await handler(request("worker/tick", {}))).status, 200);
    assert.equal(
      sql.prepare("SELECT status FROM provider_runs").get()!.status,
      "completed",
    );
    const response = await handler(request("results?filter=baseline&limit=25"));
    const feed = (await response.json()) as { total: number; items: unknown[] };
    assert.equal(feed.total, 1);
    assert.equal(feed.items.length, 1);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM alerts").get()!.n, 0);
    assert.equal(
      mock.calls.filter((c) => c.path.includes("/trigger?")).length,
      1,
    );
  } finally {
    sql.close();
  }
});

async function harness(
  overrides: Record<string, unknown> = {},
  transportOverride?: typeof fetch,
) {
  const f = database(),
    mock = transportFixture();
  const transport = transportOverride ?? mock.transport;
  const handler = createHandler(f.db, cfg, {
    development: true,
    provider: () =>
      new BrightDataProvider(
        {
          apiKey: cfg.BRIGHTDATA_API_KEY,
          rightsConfirmed: "true",
          dataset: cfg.BRIGHTDATA_DATASET_ID,
        },
        transport,
      ),
  });
  const saved = await handler(
    request("searches", {
      requestKey: crypto.randomUUID(),
      config: {
        name: "iPhone 14",
        query: "iPhone 14",
        city: "Curitiba",
        intent: "personal",
        maxPrice: 2200,
        intervalSeconds: 300,
        resultsPerSearch: 10,
        ...overrides,
      },
    }),
  );
  assert.equal(saved.status, 201);
  const monitor = (await getMonitors(f.db, "local-radar"))[0];
  await handler(request("admin/provider/check", {}));
  const scan = () =>
    handler(
      request("scan", { monitorId: monitor.id, confirmConsumption: true }),
    );
  const tick = () => handler(request("worker/tick", {}));
  return { ...f, mock, handler, monitor, scan, tick };
}

test("hotfix: erro do job chega ao worker e ao dono/admin, antes de consumir cota", async () => {
  const f = await harness({ city: "" });
  try {
    await f.scan();
    const tick = (await (await f.tick()).json()) as {
      results: { status: string; error: string; phase: string }[];
    };
    assert.equal(tick.results[0].status, "dead");
    assert.match(tick.results[0].error, /Informe city/);
    assert.equal(tick.results[0].phase, "preflight");
    const b = (await (await f.handler(request("bootstrap"))).json()) as {
      searches: {
        operational: {
          lastError: { message: string; technical: string; action: string };
        };
      }[];
      account: { usedToday: number };
    };
    assert.match(b.searches[0].operational.lastError.message, /cidade/);
    assert.match(b.searches[0].operational.lastError.technical, /Informe city/);
    assert.match(
      b.searches[0].operational.lastError.action,
      /Revisar critérios/,
    );
    assert.equal(b.account.usedToday, 0);
    assert.equal(
      f.mock.calls.filter((c) => c.path.includes("/trigger?")).length,
      0,
    );
    // A plain account gets guidance, not diagnostic text. Another account gets no records.
    const { bootstrap } = await import("../server/bootstrap");
    const ordinary = await bootstrap(
      f.db,
      { kind: "user", userId: "local-radar", admin: false },
      cfg,
      true,
    );
    assert.equal(ordinary.searches[0].operational.lastError?.technical, null);
    const { ensureUser } = await import("../server/seed");
    await ensureUser(f.db, "another-user");
    assert.deepEqual(
      (
        await bootstrap(
          f.db,
          { kind: "user", userId: "another-user", admin: false },
          cfg,
        )
      ).searches,
      [],
    );
  } finally {
    f.sql.close();
  }
});

test("hotfix: cidade explícita e fingerprint preservados; raio e período seguem o radar atual", async () => {
  const f = await harness({
    providerFilters: {
      city: "Joinville",
      radius: 40,
      date_listed: "Last 24 hours",
    },
  });
  try {
    await f.scan();
    await f.tick();
    const call = f.mock.calls.find((c) => c.path.includes("/trigger?"))!;
    assert.ok(call);
    assert.deepEqual(call.body, [
      {
        keyword: "iphone 14",
        city: "Joinville",
        radius: 30,
        date_listed: "Last 7 days",
      },
    ]);
    assert.equal((await getMonitors(f.db, "local-radar"))[0].city, "Curitiba");
  } finally {
    f.sql.close();
  }
  const g = await harness({ providerContractFingerprint: "a".repeat(64) });
  try {
    await g.scan();
    await g.tick();
    assert.equal(
      g.mock.calls.filter((c) => c.path.includes("/trigger?")).length,
      0,
    );
    assert.match(
      String(g.sql.prepare("SELECT errors FROM provider_runs").get()!.errors),
      /contrato.*mudou/i,
    );
    assert.equal(
      (await getMonitors(g.db, "local-radar"))[0].providerContractFingerprint,
      "a".repeat(64),
    );
  } finally {
    g.sql.close();
  }
});

test("hotfix: fila, snapshot pendente e próxima consulta ficam visíveis mesmo no piloto e com cota usada", async () => {
  const f = await harness();
  try {
    f.sql.prepare("UPDATE plans SET daily_triggers=1 WHERE id='managed'").run();
    await f.scan();
    const replay = await f.scan();
    const reply = (await replay.json()) as { queued: number; message: string };
    assert.equal(reply.queued, 0);
    assert.match(reply.message, /Nenhuma solicitação adicional/);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM jobs").get()!.n, 1);
    await f.tick();
    const b = (await (await f.handler(request("bootstrap"))).json()) as {
      searches: {
        operational: {
          status: string;
          nextAttempt: string;
          snapshotId: string;
        };
      }[];
      service: { quotaPaused: boolean };
    };
    assert.equal(b.service.quotaPaused, true);
    assert.equal(b.searches[0].operational.status, "buscando");
    assert.ok(b.searches[0].operational.nextAttempt);
    assert.equal(b.searches[0].operational.snapshotId, "sd_hotfix_fixture");
    f.mock.setProgress("running");
    f.sql.prepare("UPDATE jobs SET available_at='2000-01-01'").run();
    await f.tick();
    f.mock.setProgress("ready");
    f.sql.prepare("UPDATE jobs SET available_at='2000-01-01'").run();
    await f.tick();
    assert.equal(
      f.sql.prepare("SELECT status FROM provider_runs").get()!.status,
      "completed",
    );
    assert.equal(
      f.mock.calls.filter((c) => c.path.includes("/trigger?")).length,
      1,
    );
  } finally {
    f.sql.close();
  }
});

test("hotfix: download com HTTP 200 building consulta o mesmo snapshot, sem repetir POST", async () => {
  const m = transportFixture();
  let downloads = 0;
  const transport = (async (input, init) => {
    if (String(input).includes("/snapshot/") && downloads++ === 0)
      return Response.json({
        status: "building",
        message: "Snapshot is building, try again in 10s",
      });
    return m.transport(input, init);
  }) as typeof fetch;
  const f = await harness({}, transport);
  try {
    await f.scan();
    await f.tick();
    f.sql.prepare("UPDATE jobs SET available_at='2000-01-01'").run();
    await f.tick();
    assert.equal(
      f.sql.prepare("SELECT status FROM provider_runs").get()!.status,
      "waiting",
    );
    f.sql.prepare("UPDATE jobs SET available_at='2000-01-01'").run();
    await f.tick();
    assert.equal(
      f.sql.prepare("SELECT status FROM provider_runs").get()!.status,
      "completed",
    );
    assert.equal(m.calls.filter((c) => c.path.includes("/trigger?")).length, 1);
  } finally {
    f.sql.close();
  }
});

test("hotfix: erro de disparo incerto continua bloqueando nova cobrança e tem orientação visível", async () => {
  const m = transportFixture();
  let triggers = 0;
  const transport = (async (input, init) => {
    if (String(input).includes("/trigger?")) {
      triggers++;
      throw new Error("simulated lost connection");
    }
    return m.transport(input, init);
  }) as typeof fetch;
  const f = await harness({}, transport);
  try {
    await f.scan();
    await f.tick();
    const retry = await f.scan();
    assert.equal(retry.status, 503);
    assert.match(
      ((await retry.json()) as { error: string }).error,
      /Não repita/,
    );
    for (let i = 0; i < 2; i++) await f.tick();
    assert.equal(triggers, 1);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM listings").get()!.n, 0);
  } finally {
    f.sql.close();
  }
});

test("hotfix: uma nova tentativa corrige o monitor antigo sem apagar seu histórico ou editar a busca", async () => {
  const f = await harness();
  try {
    await f.scan();
    const job = f.sql.prepare("SELECT id,scope_id FROM jobs").get()!;
    f.sql
      .prepare(
        "UPDATE jobs SET status='dead',error='Informe city: obrigatório no contrato da Bright Data.',payload=json_set(payload,'$.triggerStarted',json('false'))",
      )
      .run();
    f.sql
      .prepare(
        "INSERT INTO provider_runs(id,user_id,monitor_id,provider,query_type,kind,status,started_at,completed_at,records_requested,errors) VALUES (?,'local-radar',?,'brightdata','keyword','monitor','failed','2026-01-01','2026-01-01',10,?)",
      )
      .run(
        job.id,
        f.monitor.id,
        JSON.stringify({
          message: "Informe city: obrigatório no contrato da Bright Data.",
        }),
      );
    const before = JSON.stringify(await getMonitors(f.db, "local-radar"));
    assert.equal((await f.scan()).status, 202);
    await f.tick();
    assert.equal(
      f.sql.prepare("SELECT status FROM provider_runs WHERE id=?").get(job.id)!
        .status,
      "failed",
    );
    assert.equal(
      f.sql
        .prepare("SELECT COUNT(*) n FROM provider_runs WHERE status='waiting'")
        .get()!.n,
      1,
    );
    assert.equal(
      JSON.stringify(await getMonitors(f.db, "local-radar")),
      before,
    );
  } finally {
    f.sql.close();
  }
});

test("hotfix: ready/failed HTTP 200 não vira sucesso vazio; nenhum payload bruto vaza", async () => {
  const f = await harness();
  try {
    await f.scan();
    await f.tick();
    f.mock.setProgress("failed");
    f.sql.prepare("UPDATE jobs SET available_at='2000-01-01'").run();
    await f.tick();
    assert.equal(
      f.sql.prepare("SELECT status FROM provider_runs").get()!.status,
      "failed",
    );
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM listings").get()!.n, 0);
    const b = await (await f.handler(request("bootstrap"))).json();
    assert.equal(JSON.stringify(b).includes(cfg.BRIGHTDATA_API_KEY), false);
    assert.equal(JSON.stringify(b).includes(cfg.WORKER_TOKEN), false);
  } finally {
    f.sql.close();
  }
});

test("hotfix: cartão renderiza ação/motivo da falha e controles do snapshot sem payload bruto", async () => {
  const f = await harness({ city: "" });
  try {
    await f.scan();
    await f.tick();
    const { bootstrap } = await import("../server/bootstrap");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SearchList } = await import("../components/saas/search-list");
    const b = await bootstrap(
      f.db,
      { kind: "user", userId: "local-radar", admin: true },
      cfg,
      true,
    );
    const html = renderToStaticMarkup(
      createElement(SearchList, {
        bootstrap: b,
        onEdit() {},
        onCreate() {},
        onRefresh() {},
      }),
    );
    assert.match(html, /O que fazer/);
    assert.match(html, /Motivo técnico desta tentativa/);
    assert.match(html, /Informe city/);
    assert.equal(html.includes(cfg.BRIGHTDATA_API_KEY), false);
    assert.equal(html.includes(cfg.WORKER_TOKEN), false);
  } finally {
    f.sql.close();
  }
});
