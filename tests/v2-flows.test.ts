import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { database, fixture } from "./fixtures";
import { createHandler } from "../server/http";
import { BrightDataProvider } from "../providers/brightdata";
import { nativePublicationPolicy } from "../providers/search-policy";
import type {
  MarketplaceProvider,
  ProviderMethodSchema,
  SearchResult,
} from "../providers/contract";
import { ensureUser } from "../server/seed";
import { saveMonitor, saveFeedback } from "../server/service";
import { listingStatement } from "../server/store";
import { normalize } from "../core/normalize";
import {
  requestAvailability,
  runAvailabilityCheck,
} from "../server/availability";
import { getFeed, ensureFeed } from "../server/feed";
import { saveDeal, getDeals } from "../server/deals";
import { customerReason, negotiationMessage } from "../core/customer-copy";
import { listingAnalysis } from "../server/evaluation";
import type { Listing } from "../core/types";

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
const req = (p: string, body?: unknown) =>
  new Request("http://localhost:5173/api/v1/" + p, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: "http://localhost:5173",
      "content-type": "application/json",
      ...(p === "worker/tick"
        ? { authorization: "Bearer " + cfg.WORKER_TOKEN }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
function fake() {
  const calls: { path: string; body: unknown }[] = [];
  const transport = (async (input, init) => {
    const u = new URL(String(input));
    calls.push({
      path: u.pathname + u.search,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (u.pathname.endsWith("scrapers"))
      return Response.json(confirmedTestMetadata());
    if (u.pathname.endsWith("trigger"))
      return Response.json({ snapshot_id: "sd_v2_only" });
    if (u.pathname.includes("progress/"))
      return Response.json({
        status: "ready",
        snapshot_id: "sd_v2_only",
        dataset_id: cfg.BRIGHTDATA_DATASET_ID,
      });
    if (u.pathname.includes("snapshot/"))
      return Response.json([
        {
          url: "https://www.facebook.com/marketplace/item/112233/",
          product_id: "112233",
          title: "iPhone 14 128GB",
          description: "Usado completo, funcionando. Sem defeitos.",
          currency: "BRL",
          final_price: 1800,
          location: "Curitiba, PR",
          country_code: "BR",
          listing_date: new Date().toISOString(),
          condition: "USED",
          images: [],
        },
      ]);
    throw new Error("Unexpected mock route");
  }) as typeof fetch;
  return {
    calls,
    provider: () =>
      new BrightDataProvider(
        { apiKey: cfg.BRIGHTDATA_API_KEY, rightsConfirmed: "true" },
        transport,
      ),
  };
}
const input = () => ({
  requestKey: crypto.randomUUID(),
  activate: true,
  config: {
    name: "iPhone 14",
    query: "iPhone 14",
    product: "iPhone 14",
    intent: "personal",
    city: "Curitiba",
    maxPrice: 2200,
    condition: "working",
    intervalSeconds: 300,
  },
});

test("2.0: ativar salva, pesquisa no piloto e persiste resultados sem segundo botão; replay não cobra duas vezes", async () => {
  const { db, sql } = database(),
    mock = fake(),
    h = createHandler(db, cfg, { development: true, provider: mock.provider });
  try {
    assert.equal((await h(req("admin/provider/check", {}))).status, 200);
    const body = input(),
      saved = await h(req("searches", body));
    assert.equal(saved.status, 201, await saved.clone().text());
    const data = (await saved.json()) as { monitor: { id: string } };
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM jobs").get()!.n, 1);
    assert.equal((await h(req("searches", body))).status, 200);
    await h(req("worker/tick", {}));
    sql.exec("UPDATE jobs SET available_at='2000-01-01'");
    await h(req("worker/tick", {}));
    const out = await h(req("results?monitorId=" + data.monitor.id));
    const feed = (await out.json()) as { total: number };
    assert.equal(feed.total, 1);
    const status = (await (await h(req("admin/status"))).json()) as {
      quality: { received: number; withinBudget: number };
    };
    assert.equal(status.quality.received, 1);
    assert.equal(status.quality.withinBudget, 1);
    const { qualitySummary } = await import("../server/quality");
    assert.equal((await qualitySummary(db, "unrelated-account")).received, 0);
    assert.equal(
      mock.calls.filter((c) => c.path.includes("/trigger?")).length,
      1,
    );
    const payload = mock.calls.find((c) => c.path.includes("/trigger?"))!
      .body as { date_listed: string; keyword: string; city: string }[];
    assert.equal(payload[0].keyword, "iphone 14");
    assert.equal(payload[0].city, "Curitiba");
    assert.equal(payload[0].date_listed, "Last 7 days");
    // Simulate process interruption after job completion but before outbox acknowledgment.
    sql.exec("UPDATE radar_activations SET state='pending'");
    await h(req("worker/tick", {}));
    await h(req("searches", body));
    await h(req("worker/tick", {}));
    assert.equal(
      mock.calls.filter((c) => c.path.includes("/trigger?")).length,
      1,
    );
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM monitors").get()!.n, 1);
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM alerts").get()!.n,
      0,
      "Sem falsa novidade na primeira busca",
    );
    assert.equal(
      JSON.parse(
        String(
          sql
            .prepare(
              "SELECT preferences FROM accounts WHERE user_id='local-radar'",
            )
            .get()!.preferences,
        ),
      ).city,
      "Curitiba",
    );
  } finally {
    sql.close();
  }
});
test("2.0: ativação aguarda configuração sem custo e retoma pelo worker após validação", async () => {
  const { db, sql } = database(),
    mock = fake();
  const h = createHandler(
    db,
    { ...cfg, COLLECTION_ENABLED: "false" },
    { development: true, provider: mock.provider },
  );
  try {
    assert.equal((await h(req("searches", input()))).status, 201);
    await h(req("worker/tick", {}));
    assert.equal(mock.calls.length, 0);
    const enabled = createHandler(db, cfg, {
      development: true,
      provider: mock.provider,
    });
    await enabled(req("admin/provider/check", {}));
    await enabled(req("worker/tick", {}));
    assert.equal(
      mock.calls.filter((c) => c.path.includes("/trigger?")).length,
      1,
    );
  } finally {
    sql.close();
  }
});
const schema = (options: string[]): ProviderMethodSchema => ({
  contract: "discover_by_keyword",
  fingerprint: "observed",
  compatible: true,
  issues: [],
  fields: [
    {
      name: "date_listed",
      type: "string",
      required: false,
      supported: true,
      inputEnabled: true,
      options,
    },
  ],
});
test("2.0: sete dias exige opção confirmada; não substitui por 24h", () => {
  const q = {
    type: "keyword" as const,
    keyword: "iphone 14",
    contractFingerprint: "observed",
  };
  assert.equal(
    nativePublicationPolicy(q, schema(["Last 24 hours", "Last 7 days"])).query
      .filters?.date_listed,
    "Last 7 days",
  );
  const limited = nativePublicationPolicy(q, schema(["Last 24 hours"]));
  assert.equal(limited.days, null);
  assert.equal(limited.coverage, "local_only");
  assert.match(limited.issue!, /7 dias/);
  assert.equal(
    nativePublicationPolicy(q, schema(["All time"])).coverage,
    "local_only",
  );
  assert.equal(
    nativePublicationPolicy(
      { ...q, filters: { date_listed: "All time" } },
      schema(["Last 24 hours", "All time"]),
    ).coverage,
    "local_only",
  );
  assert.equal(
    nativePublicationPolicy(q, schema(["Last 24 hours", "Last 7 days"]), 1440)
      .days,
    1,
  );
});
async function seed() {
  const d = database();
  await ensureUser(d.db, "u1");
  await ensureUser(d.db, "u2");
  await saveMonitor(d.db, "u1", {
    name: "iPhone14",
    query: "iPhone 14",
    product: "iPhone 14",
    city: "Curitiba",
    intent: "personal",
    maxPrice: 2200,
    maxListingAgeMinutes: 10080,
  });
  const raw = {
    ...fixture().listing,
    id: "v2listing",
    externalId: "1010",
    url: "https://www.facebook.com/marketplace/item/1010/",
    title: "iPhone 14 128GB",
    description: "Usado funcionando, sem defeitos.",
    price: 1800,
    publishedAt: new Date().toISOString(),
    publicationConfidence: 100,
    publicationStatus: "valid" as const,
    availability: "unknown" as const,
    city: "Curitiba",
    baseline: true,
  };
  const l: Listing = { ...raw, product: normalize(raw) };
  await listingStatement(d.db, "u1", l).run();
  return { ...d, l };
}
test("2.0: pipeline persiste negociação, compra e venda reais, com versão e isolamento", async () => {
  const { db, sql, l } = await seed();
  try {
    await saveDeal(db, "u1", l.id, { stage: "interested" });
    await saveDeal(db, "u1", l.id, {
      stage: "negotiating",
      expectedVersion: 1,
      note: "Conversa iniciada",
    });
    await assert.rejects(
      saveDeal(db, "u2", l.id, { stage: "interested" }),
      /NOT_FOUND/,
    );
    await assert.rejects(
      saveDeal(db, "u1", l.id, { stage: "for_sale", expectedVersion: 2 }),
      /Registre/,
    );
    await saveFeedback(db, "u1", {
      type: "bought",
      listingId: l.id,
      paid: 1700,
      costs: 100,
    });
    await saveDeal(db, "u1", l.id, { stage: "for_sale", expectedVersion: 3 });
    await saveFeedback(db, "u1", {
      type: "sold",
      listingId: l.id,
      soldFor: 2200,
      additionalCosts: 50,
    });
    const deals = await getDeals(db, "u1", 1, 25, "sold");
    assert.equal(deals.total, 1);
    assert.equal(deals.items[0].purchase.paid, 1700);
    assert.equal(deals.items[0].purchase.soldFor, 2200);
    assert.equal((await getDeals(db, "u2")).total, 0);
    await assert.rejects(
      saveDeal(db, "u1", l.id, { stage: "interested", expectedVersion: 5 }),
      /venda já/,
    );
  } finally {
    sql.close();
  }
});
test("2.0: item expira da vitrine sem nova coleta e continua no histórico", async () => {
  const { db, sql, l } = await seed();
  try {
    const old = {
      ...l,
      publishedAt: new Date(Date.now() - 10080 * 60000 + 1000).toISOString(),
    };
    await listingStatement(db, "u1", old).run();
    await ensureFeed(db, "u1");
    assert.equal((await getFeed(db, "u1")).total, 1);
    // Expiry in cached summaries simulates clock advancement without rebuilding or network access.
    sql.exec(
      "UPDATE feed_entries SET data=json_set(data,'$.analysis.displayExpiresAt','2000-01-01','$.assessments[0].displayExpiresAt','2000-01-01')",
    );
    assert.equal((await getFeed(db, "u1")).total, 0);
    assert.equal((await getFeed(db, "u1", { filter: "history" })).total, 1);
  } finally {
    sql.close();
  }
});
test("2.0: filtro por radar não herda orçamento de outro radar", async () => {
  const { db, sql } = await seed();
  try {
    const other = await saveMonitor(db, "u1", {
      name: "Barato",
      product: "iPhone 14",
      query: "iPhone 14",
      city: "Curitiba",
      intent: "personal",
      maxPrice: 1000,
    });
    assert.equal((await getFeed(db, "u1")).total, 1);
    assert.equal((await getFeed(db, "u1", { monitorId: other.id })).total, 0);
  } finally {
    sql.close();
  }
});
test("2.0: cópia comercial não exibe fórmulas e mensagem de negociação não envia contato", async () => {
  assert.doesNotMatch(
    [
      "baseline inicial",
      "P25 vezes 0,97",
      "Opportunity Score abaixo do mínimo",
      "fator de calibração",
    ]
      .map(customerReason)
      .join(" "),
    /baseline|P25|Score|calibração/,
  );
  const { db, sql, l } = await seed();
  try {
    const o = await listingAnalysis(db, "u1", l.id);
    assert.match(negotiationMessage(o, 1700), /1\.700,00/);
    assert.match(negotiationMessage(o), /ainda está disponível/);
  } finally {
    sql.close();
  }
});
function checker(
  l: Listing,
  fn: () => Promise<SearchResult>,
): MarketplaceProvider {
  return {
    id: "brightdata",
    capabilities: {
      discovery: true,
      publicationTime: true,
      locationFilter: false,
      availability: true,
      images: true,
    },
    healthCheck: async () => ({
      ok: true,
      message: "fixture",
      methods: { keyword: true, search_url: false, collect_url: true },
    }),
    search: async () => {
      throw new Error("No discovery in this test");
    },
    getListing: async () => l,
    getImages: () => [],
    getSellerInfo: () => ({ id: null }),
    getPublicationTime: () => ({ value: l.publishedAt, confidence: 100 }),
    checkListing: fn,
  };
}
const verification = { ...cfg, AVAILABILITY_ENABLED: "true" };
test("2.0: conferência paga é única, reaproveita consulta recente e retira vendido da vitrine", async () => {
  const { db, sql, l } = await seed();
  let calls = 0;
  const provider = checker(l, async () => {
    calls++;
    return {
      items: [{ ...l, availability: "sold" }],
      complete: true,
      warnings: [],
    };
  });
  try {
    await requestAvailability(db, "u1", l.id, verification);
    await requestAvailability(db, "u1", l.id, verification);
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM availability_checks").get()!.n,
      1,
    );
    assert.equal(
      (await runAvailabilityCheck(db, "u1", () => provider, verification))
        .status,
      "completed",
    );
    assert.equal(calls, 1);
    assert.equal((await getFeed(db, "u1")).total, 0);
    assert.equal((await getFeed(db, "u1", { filter: "history" })).total, 1);
    await runAvailabilityCheck(db, "u1", () => provider, verification);
    assert.equal(calls, 1);
  } finally {
    sql.close();
  }
});
test("2.0: conferência interrompida após disparo não cobra novamente; dados inconclusivos não viram vendido", async () => {
  const { db, sql, l } = await seed();
  let calls = 0;
  const provider = checker(l, async () => {
    calls++;
    throw new Error("Timeout");
  });
  try {
    await requestAvailability(db, "u1", l.id, verification);
    assert.equal(
      (await runAvailabilityCheck(db, "u1", () => provider, verification))
        .status,
      "uncertain",
    );
    await runAvailabilityCheck(db, "u1", () => provider, verification);
    assert.equal(calls, 1);
    await assert.rejects(
      requestAvailability(db, "u1", l.id, verification),
      /anterior ficou/,
    );
    assert.equal(
      JSON.parse(String(sql.prepare("SELECT data FROM listings").get()!.data))
        .availability,
      "unknown",
    );
  } finally {
    sql.close();
  }
});
test("2.0: somente snapshot já pago continua quando conferências são desabilitadas", async () => {
  const { db, sql, l } = await seed();
  let calls = 0;
  const provider = checker(l, async () => {
    calls++;
    return calls === 1
      ? { items: [], complete: false, cursor: "sd_verify", warnings: [] }
      : { items: [l], complete: true, warnings: [] };
  });
  try {
    await requestAvailability(db, "u1", l.id, verification);
    assert.equal(
      (await runAvailabilityCheck(db, "u1", () => provider, verification))
        .status,
      "waiting",
    );
    sql.exec("UPDATE availability_checks SET available_at='2000-01-01'");
    assert.equal(
      (
        await runAvailabilityCheck(db, "u1", () => provider, {
          ...verification,
          AVAILABILITY_ENABLED: "false",
          COLLECTION_ENABLED: "false",
        })
      ).status,
      "completed",
    );
    assert.equal(calls, 2);
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM budget_reservations").get()!.n,
      1,
    );
  } finally {
    sql.close();
  }
});

test("2.0: cadência real cabe na cota e não promete cinco minutos com cinco consultas diárias", async () => {
  const { plannedInterval, intervalLabel } =
    await import("../core/service-schedule");
  assert.equal(plannedInterval(300, 60, 5, 1), 17280);
  assert.equal(plannedInterval(300, 60, 5, 2), 34560);
  assert.equal(plannedInterval(300, 60, 100, 1, 5, 3), 51840);
  assert.equal(intervalLabel(17280), "4 h 48 min");
});
test("2.0: raio é enviado apenas se contrato confirma número em quilômetros", async () => {
  const { nativeRadius } = await import("../providers/search-policy");
  const base = {
    method: "keyword",
    fields: [],
    compatible: true,
  } as unknown as ProviderMethodSchema;
  const query = { type: "keyword" as const, keyword: "iPhone 14", filters: {} };
  assert.throws(() => nativeRadius(query, base, 30), /raio/);
  const schema = {
    ...base,
    fields: [{ name: "radius", type: "number", supported: true, unit: "km" }],
  } as unknown as ProviderMethodSchema;
  assert.deepEqual(nativeRadius(query, schema, 30), {
    ...query,
    filters: { radius: 30 },
  });
  assert.deepEqual(
    nativeRadius({ ...query, filters: { radius: 10 } }, schema, 30),
    { ...query, filters: { radius: 30 } },
  );
  assert.deepEqual(
    nativeRadius(
      query,
      { ...schema, fields: [{ ...schema.fields[0], unit: "miles" }] },
      30,
    ),
    { ...query, filters: { radius: Number((30 / 1.609344).toPrecision(15)) } },
  );
});
test("2.0: aviso pendente expirado não é enviado nem causa nova coleta", async () => {
  const { deliverOne } = await import("../server/notifications");
  const { db, sql } = database();
  await ensureUser(db, "u1");
  const l = {
    ...fixture().listing,
    publishedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
    publicationStatus: "valid" as const,
  };
  try {
    await listingStatement(db, "u1", l).run();
    sql
      .prepare(
        "INSERT INTO alerts(id,user_id,listing_id,event_key,created_at,data) VALUES ('old','u1',?,'old',?,?)",
      )
      .run(
        l.id,
        new Date().toISOString(),
        JSON.stringify({ id: "old", listingId: l.id, demo: false }),
      );
    sql.exec(
      "INSERT INTO notification_outbox(id,user_id,alert_id,channel,status,available_at) VALUES('out','u1','old','telegram','pending','2000-01-01')",
    );
    let sent = 0;
    const result = await deliverOne(db, "u1", {
      async send() {
        sent++;
      },
    });
    assert.equal(result.status, "suppressed");
    assert.equal(sent, 0);
    assert.equal(
      sql
        .prepare("SELECT status FROM notification_outbox WHERE id='out'")
        .get()!.status,
      "failed",
    );
  } finally {
    sql.close();
  }
});

test("2.0: radar de 24h expirado não esconde resultado ainda válido no radar de 7 dias", async () => {
  const { db, sql, l } = await seed();
  try {
    const shorter = await saveMonitor(db, "u1", {
      name: "Hoje",
      product: "iPhone 14",
      query: "iPhone 14",
      city: "Curitiba",
      intent: "personal",
      maxPrice: 2200,
      maxListingAgeMinutes: 1440,
    });
    await ensureFeed(db, "u1");
    const entry = sql
      .prepare("SELECT listing_id,data FROM feed_entries WHERE listing_id=?")
      .get(l.id)!;
    const o = JSON.parse(String(entry.data));
    const short = o.assessments.find(
      (a: { monitorId: string }) => a.monitorId === shorter.id,
    );
    short.displayExpiresAt = "2000-01-01";
    o.analysis = short;
    sql
      .prepare("UPDATE feed_entries SET data=? WHERE listing_id=?")
      .run(JSON.stringify(o), l.id);
    assert.equal((await getFeed(db, "u1")).total, 1);
    assert.equal((await getFeed(db, "u1", { monitorId: shorter.id })).total, 0);
    assert.notEqual(
      (await getFeed(db, "u1")).items[0].analysis.monitorId,
      shorter.id,
    );
  } finally {
    sql.close();
  }
});
