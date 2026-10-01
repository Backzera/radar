import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseBRL, parsePublication } from "../core/provider-values";
import { validateSearchUrl } from "../core/provider-query";
import { discoveryDelay, freshness } from "../core/freshness";
import { analyze } from "../core/opportunity";
import { DEFAULT_SETTINGS, type RawListing } from "../core/types";
import { BrightDataProvider } from "../providers/brightdata";
import { MockProvider, demoNew } from "./mock";
import { ProviderError } from "../providers/contract";
import { ingest, materialize } from "../server/ingestion";
import { getListings, getAlerts, all } from "../server/store";
import { enqueue, enqueueTest, runOne, reserveBudget } from "../server/worker";
import { pilotConfig, providerBudgetKey } from "../server/pilot";
import { diagnostics, checkProvider } from "../server/diagnostics";
import { saveMonitor, state } from "../server/service";
import { database, now, monitor } from "./fixtures";
const url =
  "https://www.facebook.com/marketplace/curitiba/search/?query=iphone%2015&sortBy=creation_time_descend&radius=40&maxPrice=10000";
const fields = ["product_id", "url", "title", "final_price", "currency"].map(
  (name) => ({ name }),
);
const metadata = [
  {
    id: "gd_lvt9iwuh6fbcwmx1a",
    domain: "facebook.com",
    scrapers: {
      discover_by_keyword: {
        input_schema: [{ name: "keyword", type: "text", required: true }],
        output_fields: fields,
      },
      discover_by_category_url: {
        input_schema: [{ name: "url", type: "url", required: true }],
        output_fields: fields,
      },
    },
  },
];
const input = {
  product_id: "123",
  url: "https://www.facebook.com/marketplace/item/123/?ref=search",
  title: "iPhone 15 128GB",
  description: "Usado em excelente estado",
  final_price: "R$ 2.500",
  currency: "BRL",
  location: "Curitiba, PR",
  listing_date: "2026-09-10T11:58:00-03:00",
  country_code: "BR",
};
const config = pilotConfig({});
function real(i: number, price = 3200 + i * 10): RawListing {
  return {
    ...demoNew(0, 0, now),
    externalId: String(1000 + i),
    url: `https://www.facebook.com/marketplace/item/${1000 + i}/`,
    sellerId: `seller${i}`,
    price,
    provider: "brightdata",
    demo: false,
    availability: "unknown",
    publicationStatus: "valid",
  };
}
test("BRL parser distingue milhar/centavos e não inventa preço", () => {
  for (const value of ["R$ 2.500", 2500, "2.500,00", "2500.00"])
    assert.equal(parseBRL(value), 2500);
  for (const value of [null, undefined, "", "a combinar", "2,500.00", -1])
    assert.equal(parseBRL(value), null);
});
test("URL de busca preserva filtros e rejeita SSRF, redirecionamentos e tokens", () => {
  assert.ok(validateSearchUrl(url));
  for (const value of [
    "http://www.facebook.com/marketplace/search/?query=x",
    "https://localhost/marketplace/search/",
    "https://127.0.0.1/marketplace/search/",
    "https://facebook.com.evil.com/marketplace/search/",
    "https://facebook.com:999/marketplace/search/",
    "file:///marketplace/search/",
    "https://facebook.com/marketplace/item/123/",
    "https://facebook.com/marketplace/search/?next=https://evil.com",
    "https://facebook.com/marketplace/search/?access_token=secret",
    "https://name:pw@facebook.com/marketplace/search/",
    "https://facebook.com/marketplace/search/#fragment",
  ])
    assert.equal(validateSearchUrl(value), false, value);
});
test("datas UTC, timezone brasileiro, 2min, 2h, 20dias, ausente e futuro", () => {
  assert.equal(
    parsePublication(input.listing_date, now).value,
    "2026-09-10T14:58:00.000Z",
  );
  for (const [minutes, expected] of [
    [2, "just_published"],
    [120, "recent"],
    [28800, "old"],
  ] as const) {
    const p = new Date(+now - minutes * 60000).toISOString();
    assert.equal(freshness(p, 75, now).freshness, expected);
    assert.equal(
      discoveryDelay({
        publishedAt: p,
        publicationConfidence: 75,
        firstSeenAt: now.toISOString(),
      }),
      minutes * 60,
    );
  }
  assert.equal(parsePublication("2026-02-30T00:00:00Z", now).status, "invalid");
  assert.equal(parsePublication("2027-01-01T00:00:00Z", now).status, "future");
  assert.equal(
    parsePublication("2026-09-10T11:58:00", now).status,
    "untrusted",
  );
  assert.equal(
    discoveryDelay({
      publishedAt: null,
      publicationConfidence: 0,
      firstSeenAt: now.toISOString(),
    }),
    null,
  );
  assert.equal(
    discoveryDelay({
      publishedAt: "2027-01-01T00:00:00Z",
      publicationConfidence: 100,
      firstSeenAt: now.toISOString(),
    }),
    null,
  );
});
test("URL discovery resolve discriminador da metadata, snapshot e download preservam original", async () => {
  const calls: { url: string; body: unknown; method: string }[] = [];
  const responses = [
    metadata,
    { snapshot_id: "s_test" },
    { status: "running", snapshot_id: "s_test" },
    {
      status: "ready",
      snapshot_id: "s_test",
      dataset_id: "gd_lvt9iwuh6fbcwmx1a",
    },
    [input],
  ];
  const p = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true", maxRecords: 5 },
    async (u, init) => {
      calls.push({
        url: String(u),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json(responses.shift());
    },
  );
  const request = {
    query: "reference",
    providerQuery: { type: "search_url" as const, url },
    city: "",
    radiusKm: 40,
    sequence: 0,
    limit: 5,
  };
  const first = await p.search(request);
  await p.search({ ...request, cursor: first.cursor });
  const last = await p.search({ ...request, cursor: first.cursor });
  assert.equal(last.items[0].price, 2500);
  assert.equal(last.items[0].originalUrl, input.url);
  assert.equal(last.items[0].snapshotId, "s_test");
  assert.equal(last.items[0].queryType, "search_url");
  const trigger = calls.find((c) => c.method === "POST")!;
  assert.deepEqual(trigger.body, [{ url }]);
  assert.equal(
    new URL(trigger.url).searchParams.get("discover_by"),
    "category_url",
  );
  assert.equal(new URL(trigger.url).searchParams.get("limit_per_input"), "5");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});
test("URL schema ausente, ambíguo ou inesperado bloqueia POST", async () => {
  for (const value of [
    [],
    [
      {
        ...metadata[0],
        scrapers: {
          collect_by_url: metadata[0].scrapers.discover_by_category_url,
        },
      },
    ],
    [
      {
        ...metadata[0],
        scrapers: {
          discover_by_a: metadata[0].scrapers.discover_by_category_url,
          discover_by_b: metadata[0].scrapers.discover_by_category_url,
        },
      },
    ],
  ]) {
    let posts = 0;
    const p = new BrightDataProvider(
      { apiKey: "fake", rightsConfirmed: "true" },
      async (_u, init) => {
        posts += Number(init?.method === "POST");
        return Response.json(value);
      },
    );
    await assert.rejects(
      p.search({
        query: "",
        providerQuery: { type: "search_url", url },
        city: "",
        radiusKm: 30,
        sequence: 0,
        limit: 5,
      }),
    );
    assert.equal(posts, 0);
  }
});
test("URL discovery trata vazio, 429, 500, timeout e progresso inesperado", async () => {
  const request = {
    query: "",
    providerQuery: { type: "search_url" as const, url },
    city: "",
    radiusKm: 30,
    sequence: 0,
    limit: 5,
    cursor: "s_test",
  };
  let i = 0;
  const empty = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    async () => Response.json(i++ ? [] : { status: "ready" }),
  );
  assert.deepEqual((await empty.search(request)).items, []);
  for (const status of [429, 500]) {
    const p = new BrightDataProvider(
      { apiKey: "fake", rightsConfirmed: "true" },
      async () => new Response("sensitive body", { status }),
    );
    await assert.rejects(
      p.search(request),
      (e: unknown) =>
        e instanceof ProviderError &&
        e.retryable &&
        !e.message.includes("sensitive"),
    );
  }
  const timed = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    async () => {
      throw Error("secret-token");
    },
  );
  await assert.rejects(
    timed.search(request),
    (e: unknown) => e instanceof ProviderError && !e.message.includes("secret"),
  );
  const invalid = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    async () => Response.json({ status: 23 }),
  );
  await assert.rejects(invalid.search(request), /progresso inesperada/);
});
test("unknown aparece no Radar e pode alertar", async () => {
  const { db, createUser } = database();
  await createUser();
  const m = await saveMonitor(db, "u1", {
    name: "iPhone real",
    query: "iPhone 15",
    provider: "brightdata",
    city: "Curitiba",
  });
  const baseline = Array.from({ length: 20 }, (_, i) => real(i));
  assert.equal(
    (await ingest(db, "u1", m, baseline, true, DEFAULT_SETTINGS, now)).alerts,
    0,
  );
  assert.equal((await getListings(db, "u1")).length, 20);
  const second = await ingest(
    db,
    "u1",
    m,
    [...baseline, real(21, 2100)],
    false,
    DEFAULT_SETTINGS,
    new Date(+now + 1000),
  );
  assert.equal(second.discoveries, 1);
  assert.equal(second.duplicates, 20);
  assert.equal(second.alerts, 1);
  const d = await state(db, "u1"),
    o = d.opportunities.find((o) => o.listing.externalId === "1021")!;
  assert.ok(o);
  const fresh = analyze(
    o.listing,
    d.opportunities.map((o) => o.listing),
    DEFAULT_SETTINGS,
    m,
    now,
  );
  assert.equal(fresh.eligible, true);
  assert.ok(fresh.score >= 80);
  assert.ok(fresh.risk < 35);
  assert.equal((await getAlerts(db, "u1"))[0].availability, "unknown");
  assert.equal(
    (
      await ingest(
        db,
        "u1",
        m,
        [real(21, 2100)],
        false,
        DEFAULT_SETTINGS,
        new Date(+now + 2000),
      )
    ).alerts,
    0,
  );
});
test("sold/removed/unavailable não alertam; preço ausente persiste sem lucro", async () => {
  for (const availability of ["sold", "removed", "unavailable"] as const) {
    const l = materialize({ ...real(1, 2100), availability }, false, now);
    assert.equal(
      analyze(
        l,
        [],
        DEFAULT_SETTINGS,
        { ...monitor, mode: "manual", manualPrice: 3000 },
        now,
      ).eligible,
      false,
    );
  }
  const { db, createUser } = database();
  await createUser();
  await ingest(
    db,
    "u1",
    { ...monitor, provider: "brightdata" },
    [{ ...real(2), price: null }],
    true,
    DEFAULT_SETTINGS,
    now,
  );
  const l = (await getListings(db, "u1"))[0];
  assert.equal(l.price, null);
  assert.equal(
    analyze(l, [], DEFAULT_SETTINGS, undefined, now).netProfit,
    null,
  );
});
test("queda real 3000→2200 não cria novo listing e preserva publicação", async () => {
  const { db, createUser } = database();
  await createUser();
  await ingest(db, "u1", monitor, [real(1, 3000)], true, DEFAULT_SETTINGS, now);
  const r = await ingest(
    db,
    "u1",
    monitor,
    [real(1, 2200)],
    false,
    DEFAULT_SETTINGS,
    new Date(+now + 60000),
  );
  assert.equal(r.discoveries, 0);
  assert.equal(r.priceChanges, 1);
  const l = (await getListings(db, "u1"))[0];
  assert.equal(l.previousPrice, 3000);
  assert.equal(
    analyze(l, [], DEFAULT_SETTINGS, undefined, new Date(+now + 60000)).event,
    "price_drop",
  );
});
test("piloto não agenda coletas reais e budget nunca ultrapassa limite", async () => {
  const { db, createUser } = database();
  await createUser();
  await saveMonitor(db, "u1", {
    name: "Real",
    query: "iPhone",
    provider: "brightdata",
  });
  assert.equal(await enqueue(db, "u1", false, { pilot: true }), 0);
  const calls = await Promise.all(
    Array.from({ length: 10 }, () => reserveBudget(db, "brightdata", 5)),
  );
  assert.equal(calls.filter(Boolean).length, 5);
  assert.equal(
    (
      await db
        .prepare("SELECT count FROM rate_limits WHERE key=?")
        .bind(providerBudgetKey("brightdata"))
        .first<{ count: number }>()
    )?.count,
    5,
  );
  assert.equal(config.externalAlerts, false);
});
test("teste manual não cria monitor, não duplica job e snapshot vazio não comprova dados reais", async () => {
  const { db, createUser } = database();
  await createUser();
  assert.equal(
    (await enqueueTest(db, "u1", { type: "search_url", url }, 5, config))
      .queued,
    1,
  );
  assert.equal(
    (await enqueueTest(db, "u1", { type: "search_url", url }, 5, config))
      .queued,
    0,
  );
  const provider = new MockProvider();
  provider.search = async () => ({ items: [], complete: true, warnings: [] });
  assert.equal((await runOne(db, "u1", () => provider, config)).status, "done");
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM monitors")
        .first<{ n: number }>()
    )?.n,
    0,
  );
  assert.equal((await diagnostics(db, "u1", config)).collectionVerified, false);
});
test("budget bloqueado não chama provider nem entra em retry", async () => {
  const { db, createUser } = database();
  await createUser();
  await reserveBudget(db, "brightdata", 1);
  await enqueueTest(
    db,
    "u1",
    { type: "keyword", keyword: "iPhone" },
    5,
    config,
  );
  let calls = 0;
  const p = new MockProvider();
  p.healthCheck = async () => {
    calls++;
    return { ok: true, message: "ok" };
  };
  p.search = async () => {
    calls++;
    return { items: [], complete: true, warnings: [] };
  };
  assert.equal(
    (await runOne(db, "u1", () => p, { ...config, maxDailyTriggers: 1 }))
      .status,
    "budget_blocked",
  );
  assert.equal(calls, 0);
  assert.equal((await runOne(db, "u1", () => p, config)).status, "idle");
});
test("falha de configuração persiste diagnóstico sem reservar disparo", async () => {
  const { db, createUser } = database();
  await createUser();
  const p = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    async () => new Response("private", { status: 401 }),
  );
  const checked = await checkProvider(db, "u1", p);
  assert.equal(checked.ok, false);
  assert.match((await diagnostics(db, "u1", config)).lastError!, /401/);
  assert.equal((await diagnostics(db, "u1", config)).usedToday, 0);
});
test("migração preserva integridade e FK do histórico aceita preço nulo", async () => {
  const { db, sql, createUser } = database();
  await createUser();
  await ingest(db, "u1", monitor, [real(1)], true, DEFAULT_SETTINGS, now);
  assert.deepEqual(await all(db, "PRAGMA foreign_key_check"), []);
  assert.equal(
    sql.prepare("PRAGMA integrity_check").get()!.integrity_check,
    "ok",
  );
});
test("upgrade V1→V1.1 preserva anúncio e snapshot existentes com FK ligada", () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  sql.exec(readFileSync("drizzle/0000_certain_zarda.sql", "utf8"));
  sql.exec(
    "INSERT INTO users VALUES ('u','date','{}',1); INSERT INTO listings VALUES ('l','u','facebook','123','https://www.facebook.com/marketplace/item/123/',NULL,'hash',0,'{\"retained\":true}',3000,'date','date'); INSERT INTO listing_snapshots VALUES ('s','l','u',3000,'unknown','date','hash','{}');",
  );
  sql.exec(readFileSync("drizzle/0001_mature_madame_hydra.sql", "utf8"));
  assert.equal(sql.prepare("SELECT price FROM listings").get()!.price, 3000);
  assert.equal(
    sql.prepare("SELECT COUNT(*) AS n FROM listing_snapshots").get()!.n,
    1,
  );
  assert.equal(
    sql.prepare("SELECT data FROM listings").get()!.data,
    '{"retained":true}',
  );
  sql.exec(
    "UPDATE listings SET price=NULL; UPDATE listing_snapshots SET price=NULL;",
  );
  assert.deepEqual(sql.prepare("PRAGMA foreign_key_check").all(), []);
  sql.close();
});
test("POST ambíguo bloqueia outro clique no mesmo teste, sem nova cobrança", async () => {
  const { db, createUser } = database();
  await createUser();
  const q = { type: "keyword" as const, keyword: "iPhone" };
  await enqueueTest(db, "u1", q, 5, config);
  let posts = 0;
  const p = new MockProvider();
  p.search = async () => {
    posts++;
    throw new ProviderError("Disparo incerto", false);
  };
  assert.equal((await runOne(db, "u1", () => p, config)).status, "dead");
  await assert.rejects(enqueueTest(db, "u1", q, 5, config), /sem confirmação/);
  assert.equal(posts, 1);
});

test("POST rejeitado por 401/403/429 permite corrigir e solicitar nova tentativa manual", async () => {
  for (const status of [401, 403, 429]) {
    const { db, createUser } = database();
    await createUser();
    const query = { type: "keyword" as const, keyword: "iPhone 15" };
    await enqueueTest(db, "u1", query, 5, config);
    let posts = 0;
    const p = new BrightDataProvider(
      { apiKey: "fake", rightsConfirmed: "true" },
      async (_, init) => {
        if (init?.method === "POST") {
          posts++;
          return new Response("private", { status });
        }
        return Response.json(metadata);
      },
    );
    assert.equal((await runOne(db, "u1", () => p, config)).status, "dead");
    assert.equal((await runOne(db, "u1", () => p, config)).status, "idle");
    assert.equal(posts, 1);
    assert.equal((await diagnostics(db, "u1", config)).usedToday, 1);
    assert.equal((await enqueueTest(db, "u1", query, 5, config)).queued, 1);
  }
});

test("health sem API key ou direitos não faz chamadas externas", async () => {
  for (const options of [{}, { apiKey: "fake", rightsConfirmed: "false" }]) {
    let calls = 0;
    const p = new BrightDataProvider(options, async () => {
      calls++;
      return Response.json(metadata);
    });
    await assert.rejects(p.healthCheck(), ProviderError);
    assert.equal(calls, 0);
  }
});
test("contrato com tipo numérico para URL não permite disparo", async () => {
  const bad = structuredClone(metadata);
  bad[0].scrapers.discover_by_category_url.input_schema[0].type = "number";
  const p = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    async () => Response.json(bad),
  );
  assert.equal((await p.healthCheck()).methods?.search_url, false);
});
test("latência mede ciclo inteiro e primeiro visto é posterior à resposta; diagnóstico por método persiste", async () => {
  const { db, createUser } = database();
  await createUser();
  await enqueueTest(db, "u1", { type: "search_url", url }, 5, config);
  const p = new MockProvider();
  let publication = "";
  p.search = async () => {
    publication = new Date().toISOString();
    return {
      items: [{ ...real(8), publishedAt: publication }],
      complete: true,
      warnings: [],
      received: 1,
      snapshotId: "s_real_fixture",
    };
  };
  const r = await runOne(db, "u1", () => p, config);
  assert.equal(r.status, "done");
  const l = (await getListings(db, "u1"))[0];
  assert.ok(Date.parse(l.firstSeenAt) >= Date.parse(publication));
  assert.equal((await diagnostics(db, "u1", config)).collectionVerified, true);
  assert.equal(
    (await diagnostics(db, "u1", config)).methods.find(
      (m) => m.method === "search_url",
    )?.observed,
    1,
  );
  assert.equal((await getAlerts(db, "u1")).length, 0);
});
