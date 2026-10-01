import test from "node:test";
import assert from "node:assert/strict";
import { database, fixture, monitor, now } from "./fixtures";
import { analyze } from "../core/opportunity";
import { normalize } from "../core/normalize";
import { financialStorage, restoreFinancials } from "../core/purchase-policy";
import { DEFAULT_SETTINGS, type Monitor, type Purchase } from "../core/types";
import { calibrationFactor } from "../core/trading";
import { priceListing } from "../core/pricing";
import { saveMonitor, state, saveFeedback } from "../server/service";
import {
  getListings,
  getMonitors,
  getAlerts,
  getPurchases,
  listingStatement,
} from "../server/store";
import { ingest, materialize } from "../server/ingestion";
import { enqueue, runOne, reserveBudget } from "../server/worker";
import { monitorSchema } from "../server/validation";
import { pilotConfig } from "../server/pilot";
import { jobLease, LeaseLost } from "../server/job-lease";
import type {
  MarketplaceProvider,
  SearchRequest,
  SearchResult,
} from "../providers/contract";
import { seedDemo } from "./seed-fixture";
const policy: Monitor = {
  ...monitor,
  mode: "manual",
  maxPrice: 2500,
  strongPrice: 2300,
  ultraPrice: 2000,
  expectedQuickSalePrice: 3000,
  minProfit: 400,
  minRoi: 15,
  minScore: 50,
  maxRisk: 40,
  maxListingAgeMinutes: 1440,
  resultsPerSearch: 25,
  costs: {
    fuel: 50,
    transport: 30,
    maintenance: 30,
    cleaning: 20,
    packaging: 20,
    other: 0,
    feePct: 0,
    commissionPct: 0,
  },
};
const listing = () => ({
  ...fixture().listing,
  price: 2200,
  availability: "unknown" as const,
  publishedAt: new Date(+now - 12 * 60000).toISOString(),
  publicationConfidence: 100,
  publicationStatus: "valid" as const,
  demo: false,
  provider: "brightdata",
});
const input = (m: Monitor) =>
  Object.fromEntries(
    Object.entries(m).filter(([k]) => !["id", "revision"].includes(k)),
  );
const fakeProvider = (
  search: (r: SearchRequest) => Promise<SearchResult>,
): MarketplaceProvider => ({
  id: "brightdata",
  capabilities: {
    discovery: true,
    publicationTime: true,
    locationFilter: false,
    availability: false,
    images: true,
  },
  healthCheck: async () => ({ ok: true, message: "fixture" }),
  search,
  getListing: async () => null,
  getImages: () => [],
  getSellerInfo: () => ({ id: null }),
  getPublicationTime: () => ({ value: null, confidence: 0 }),
});

test("worker que perde lease no preflight não reserva nem dispara e não sobrescreve snapshot", async () => {
  const { db, sql, createUser } = database();
  await createUser();
  await saveMonitor(db, "u1", input(policy));
  await enqueue(db, "u1", true);
  let started!: () => void, resume!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let posts = 0;
  const provider = fakeProvider(async () => {
    posts++;
    return { items: [], complete: false, cursor: `s_${posts}`, warnings: [] };
  });
  const slow = {
    ...provider,
    healthCheck: async () => {
      started();
      await held;
      return { ok: true, message: "fixture" };
    },
  };
  const first = runOne(db, "u1", () => slow);
  await entered;
  sql.exec("UPDATE jobs SET lease_until='2000-01-01T00:00:00Z'");
  assert.equal((await runOne(db, "u1", () => provider)).status, "waiting");
  resume();
  assert.equal((await first).status, "lease_lost");
  assert.equal(posts, 1);
  assert.equal(sql.prepare("SELECT count FROM rate_limits").get()!.count, 1);
  assert.equal(
    JSON.parse(String(sql.prepare("SELECT payload FROM jobs").get()!.payload))
      .cursor,
    "s_1",
  );
  assert.equal(
    sql.prepare("SELECT snapshot_id FROM provider_runs").get()!.snapshot_id,
    "s_1",
  );
  sql.close();
});

test("lease protege toda transação de resultado contra gravação tardia", async () => {
  const { db, sql, createUser } = database();
  await createUser();
  await saveMonitor(db, "u1", input(policy));
  await enqueue(db, "u1", true);
  const job = sql.prepare("SELECT id FROM jobs").get()!;
  sql
    .prepare("UPDATE jobs SET status='running',lease_token='old',lease_until=?")
    .run(new Date(Date.now() + 60000).toISOString());
  const lease = jobLease(db, String(job.id), "old");
  const delayed = lease.db.prepare(
    "UPDATE monitor_scopes SET sequence=sequence+1",
  );
  sql.exec("UPDATE jobs SET lease_token='new'");
  await assert.rejects(lease.db.batch([delayed]), LeaseLost);
  await assert.rejects(delayed.run(), LeaseLost);
  assert.equal(
    sql.prepare("SELECT sequence FROM monitor_scopes").get()!.sequence,
    0,
  );
  sql.close();
});

test("snapshot usa teto financeiro atual mesmo se edição ocorreu durante o poll", async () => {
  const { db, sql, createUser } = database();
  await createUser();
  const m = await saveMonitor(db, "u1", input(policy));
  let posts = 0;
  const provider = fakeProvider(async (request) => {
    if (!request.cursor) {
      posts++;
      return {
        items: [],
        complete: false,
        cursor: "s_price_rules",
        warnings: [],
      };
    }
    await saveMonitor(
      db,
      "u1",
      {
        ...input(m),
        maxPrice: 2000,
        strongPrice: 1900,
        ultraPrice: 1800,
      },
      m.id,
    );
    return {
      items: [
        {
          ...listing(),
          publishedAt: new Date(Date.now() - 60000).toISOString(),
        },
      ],
      complete: true,
      warnings: [],
    };
  });
  await enqueue(db, "u1", true);
  assert.equal((await runOne(db, "u1", () => provider)).status, "waiting");
  sql.exec(
    "UPDATE monitor_scopes SET baseline_complete=1; UPDATE search_queries SET runs=1; UPDATE jobs SET available_at='2000-01-01T00:00:00Z'",
  );
  assert.equal((await runOne(db, "u1", () => provider)).status, "done");
  assert.equal(posts, 1);
  assert.equal((await getMonitors(db, "u1"))[0].revision, m.revision);
  assert.equal((await getAlerts(db, "u1")).length, 0);
  const analysis = JSON.parse(
    String(sql.prepare("SELECT data FROM opportunities").get()!.data),
  );
  assert.equal(analysis.maxPurchasePrice, 2000);
  assert.equal(analysis.eligible, false);
  sql.close();
});

test("produto/variante e filtro local de cidade não são substituídos pela keyword do provider", () => {
  const m = {
    ...policy,
    product: "iPhone 15 128 GB",
    providerFilters: { city: "Curitiba", radius: 40 },
  };
  const wrong = {
    ...listing(),
    title: "iPhone 15 Pro 128 GB",
    product: normalize({ title: "iPhone 15 Pro 128 GB", description: "usado" }),
  };
  assert.equal(analyze(wrong, [], DEFAULT_SETTINGS, m, now).eligible, false);
  assert.equal(
    analyze({ ...listing(), city: "São Paulo" }, [], DEFAULT_SETTINGS, m, now)
      .eligible,
    false,
  );
});

test("manual sem comparáveis: lucro 650, ROI 29,55%, custos em centavos e confiança explícita", () => {
  const a = analyze(listing(), [], DEFAULT_SETTINGS, policy, now);
  assert.equal(a.netProfit, 650);
  assert.equal(a.totalCosts, 150);
  assert.equal(a.roi, 29.55);
  assert.equal(a.pricing.count, 0);
  assert.equal(a.pricing.confidence, 0);
  assert.equal(a.pricing.source, "manual");
  assert.equal(a.eligible, true);
  assert.equal(a.priceTier, "strong");
  assert.ok(a.risk < 40);
  assert.equal(
    a.score,
    Math.min(
      100,
      a.contributions.reduce((s, c) => s + c.points, 0),
    ),
  );
  const saved = JSON.parse(financialStorage(policy));
  assert.equal(saved.maxPurchase, 250000);
  assert.equal(saved.expectedQuickSale, 300000);
  assert.equal(saved.costs.fuel, 5000);
  assert.equal(restoreFinancials(policy, JSON.stringify(saved)).maxPrice, 2500);
});
test("máximo, forte, ultra e lucro/ROI são exigidos em todos os modos", () => {
  for (const [price, tier] of [
    [2450, "interesting"],
    [2250, "strong"],
    [1950, "ultra"],
    [2900, "above_limit"],
  ] as const) {
    const a = analyze(
      { ...listing(), price },
      [],
      DEFAULT_SETTINGS,
      policy,
      now,
    );
    assert.equal(a.priceTier, tier);
    if (price === 1950) assert.equal(a.ultra, true);
    if (price === 2900) assert.equal(a.eligible, false);
  }
  for (const mode of ["manual", "combined"] as const) {
    assert.equal(
      analyze(
        listing(),
        [],
        DEFAULT_SETTINGS,
        { ...policy, mode, minProfit: 651 },
        now,
      ).eligible,
      false,
    );
    assert.equal(
      analyze(
        listing(),
        [],
        DEFAULT_SETTINGS,
        { ...policy, mode, minRoi: 30 },
        now,
      ).eligible,
      false,
    );
  }
  const auto = analyze(
    listing(),
    [],
    DEFAULT_SETTINGS,
    { ...policy, mode: "automatic" },
    now,
  );
  assert.equal(auto.netProfit, null);
  assert.equal(auto.eligible, false);
  const fallback = analyze(
    listing(),
    fixture().pool.map((l) => ({ ...l, demo: true })),
    DEFAULT_SETTINGS,
    { ...policy, mode: "combined" },
    now,
  );
  assert.equal(fallback.pricing.count, 0);
  assert.equal(fallback.pricing.source, "manual");
});
test("custos locais, taxas, comissão e ausência de preço nunca inventam margem", () => {
  const m = {
    ...policy,
    costs: { ...policy.costs!, feePct: 2, commissionPct: 3 },
  };
  assert.equal(analyze(listing(), [], DEFAULT_SETTINGS, m, now).netProfit, 500);
  for (const row of [
    { ...listing(), price: null },
    { ...listing(), title: "iPhone 15 entrada 500 e parcelas", price: 500 },
  ]) {
    const a = analyze(row, [], DEFAULT_SETTINGS, policy, now);
    assert.equal(a.netProfit, null);
    assert.equal(a.eligible, false);
  }
});
test("recência usa publicação; antigo, desconhecido, futuro e price drop velho ficam no histórico", () => {
  for (const minutes of [1441, 15 * 1440]) {
    const row = {
      ...listing(),
      publishedAt: new Date(+now - minutes * 60000).toISOString(),
      firstSeenAt: now.toISOString(),
    };
    const a = analyze(row, [], DEFAULT_SETTINGS, policy, now);
    assert.equal(a.eligible, false);
    assert.ok(a.blocked.includes("Fora da janela de oportunidade"));
    assert.equal(
      analyze(
        { ...row, previousPrice: 2800, priceChangedAt: now.toISOString() },
        [],
        DEFAULT_SETTINGS,
        policy,
        now,
      ).eligible,
      false,
    );
  }
  for (const publishedAt of [null, new Date(+now + 1000).toISOString()])
    assert.equal(
      analyze({ ...listing(), publishedAt }, [], DEFAULT_SETTINGS, policy, now)
        .eligible,
      false,
    );
  assert.equal(
    analyze(
      {
        ...listing(),
        publishedAt: new Date(+now - 1440 * 60000).toISOString(),
      },
      [],
      DEFAULT_SETTINGS,
      { ...policy, minScore: 0 },
      now,
    ).eligible,
    true,
  );
  assert.equal(
    analyze(
      {
        ...listing(),
        publishedAt: new Date(+now - 20 * 1440 * 60000).toISOString(),
      },
      [],
      DEFAULT_SETTINGS,
      { ...policy, maxListingAgeMinutes: null, minScore: 0 },
      now,
    ).eligible,
    false, // V2: legado ilimitado não supera o máximo de sete dias.
  );
  assert.ok(
    analyze(listing(), [], DEFAULT_SETTINGS, policy, now).score >
      analyze(
        {
          ...listing(),
          publishedAt: new Date(+now - 700 * 60000).toISOString(),
        },
        [],
        DEFAULT_SETTINGS,
        policy,
        now,
      ).score,
  );
});
test("20 baseline, 20 repetidos + 1 novo unknown, dedup e price drop recente", async () => {
  const { db, createUser } = database();
  await createUser();
  const rows = Array.from({ length: 20 }, (_, i) => ({
    ...listing(),
    externalId: String(90000 + i),
    url: `https://www.facebook.com/marketplace/item/${90000 + i}/`,
    price: 2800,
  }));
  assert.equal(
    (await ingest(db, "u1", policy, rows, true, DEFAULT_SETTINGS, now)).alerts,
    0,
  );
  const fresh = {
    ...listing(),
    externalId: "99999",
    url: "https://www.facebook.com/marketplace/item/99999/",
  };
  const next = await ingest(
    db,
    "u1",
    policy,
    [...rows, fresh],
    false,
    DEFAULT_SETTINGS,
    now,
  );
  assert.equal(next.discoveries, 1);
  assert.equal(next.alerts, 1);
  assert.equal(
    (
      await ingest(
        db,
        "u1",
        policy,
        [fresh],
        false,
        DEFAULT_SETTINGS,
        new Date(+now + 1000),
      )
    ).alerts,
    0,
  );
  const dropped = await ingest(
    db,
    "u1",
    policy,
    [{ ...rows[0], price: 2200 }],
    false,
    DEFAULT_SETTINGS,
    new Date(+now + 2000),
  );
  assert.equal(dropped.discoveries, 0);
  assert.equal(dropped.priceChanges, 1);
  assert.equal(dropped.alerts, 1);
  assert.equal(
    (await getAlerts(db, "u1")).filter((a) => a.event === "price_drop").length,
    1,
  );
});
test("real mode ignora todo seed persistido e aceita apenas monitores Bright Data", async () => {
  const { db } = database();
  await seedDemo(db, "u1");
  await listingStatement(db, "u1", listing()).run();
  const d = await state(db, "u1");
  assert.equal(d.totalListings, 1);
  assert.equal(d.monitors.length, 0);
  assert.equal(d.alerts.length, 0);
  assert.equal(d.purchases.length, 0);
  assert.equal(d.opportunities.length, 1);
  assert.equal(d.realMode, true);
  assert.equal(d.opportunities[0].analysis.pricing.count, 0);
  assert.throws(() =>
    monitorSchema.parse({ ...input(policy), provider: "demo" }),
  );
});
test("monitor persiste regras e cents; editar só preço preserva baseline/revision", async () => {
  const { db, createUser } = database();
  await createUser();
  const m = await saveMonitor(db, "u1", input(policy));
  const restored = (await getMonitors(db, "u1"))[0];
  assert.equal(restored.expectedQuickSalePrice, 3000);
  assert.equal(restored.resultsPerSearch, 25);
  assert.equal(restored.maxListingAgeMinutes, 1440);
  assert.deepEqual(restored.costs, policy.costs);
  const edited = await saveMonitor(
    db,
    "u1",
    { ...input(restored), maxPrice: 2550 },
    m.id,
  );
  assert.equal(edited.revision, m.revision);
  const query = await saveMonitor(
    db,
    "u1",
    { ...input(edited), query: "iPhone 16" },
    m.id,
  );
  assert.equal(query.revision, m.revision + 1);
  for (const update of [
    { maxPrice: 1.001 },
    { minRoi: -1 },
    { minProfit: -1 },
    { maxListingAgeMinutes: 4 },
    { intervalSeconds: 1 },
    { strongPrice: 2600 },
    { ultraPrice: 2400 },
    { resultsPerSearch: 51 },
  ])
    assert.equal(
      monitorSchema.safeParse({ ...input(policy), ...update }).success,
      false,
    );
});
test("piloto, pausa, jobs demo e budget não disparam provider", async () => {
  const { db, createUser } = database();
  await createUser();
  const m = await saveMonitor(db, "u1", input(policy));
  assert.equal(await enqueue(db, "u1", false, { pilot: true }), 0);
  assert.equal(await enqueue(db, "u1", true), 1);
  assert.equal(await enqueue(db, "u1", true), 0);
  await db
    .prepare(
      "UPDATE monitors SET active=0,config=json_set(config,'$.active',json('false')) WHERE id=?",
    )
    .bind(m.id)
    .run();
  let calls = 0;
  const result = await runOne(db, "u1", () => {
    calls++;
    throw new Error("must not call");
  });
  assert.equal(result.status, "canceled");
  assert.equal(calls, 0);
  for (let i = 0; i < 5; i++)
    assert.equal(await reserveBudget(db, "brightdata", 5), true);
  assert.equal(await reserveBudget(db, "brightdata", 5), false);
  assert.equal(
    pilotConfig({
      PILOT_MODE: "true",
      BRIGHTDATA_MAX_RECORDS_PER_TRIGGER: "25",
    }).maxRecords,
    25,
  );
  assert.equal(pilotConfig({}).maxRecords, 10);
});
test("compras/vendas guardam estimativa, custos extras, datas e nota sem alterar anúncio", async () => {
  const { db, createUser } = database();
  await createUser();
  const row = listing();
  await listingStatement(db, "u1", row).run();
  await saveMonitor(db, "u1", input(policy));
  await saveFeedback(db, "u1", {
    listingId: row.id,
    type: "bought",
    paid: 2100,
    costs: 100,
    note: "Teste funcional",
    boughtAt: now.toISOString(),
  });
  await saveFeedback(db, "u1", {
    listingId: row.id,
    type: "sold",
    soldFor: 3000,
    saleFees: 50,
    additionalCosts: 20,
  });
  const p = (await getPurchases(db, "u1", true))[0];
  assert.equal(p.estimated, 3000);
  assert.equal(p.estimateSource, "manual");
  assert.equal(p.automaticBaseEstimate, null);
  assert.equal(p.advertisedPrice, 2200);
  assert.equal(p.note, "Teste funcional");
  assert.equal(
    p.soldFor! - p.paid - p.costs - p.saleFees! - p.additionalCosts!,
    730,
  );
  assert.equal((await getListings(db, "u1"))[0].availability, "unknown");
});

test("falha na oportunidade ou alerta desfaz toda a observação; retry alerta uma única vez", async () => {
  for (const target of ["opportunities", "alerts", "notification_outbox"]) {
    const { db, sql, createUser } = database();
    await createUser();
    const m = await saveMonitor(db, "u1", input(policy));
    const rows = Array.from({ length: 21 }, (_, i) => ({
      ...listing(),
      externalId: `atomic-${i}`,
      url: `https://www.facebook.com/marketplace/item/${7000000 + i}/`,
    }));
    sql.exec(
      `CREATE TRIGGER fail_ingest BEFORE INSERT ON ${target} BEGIN SELECT RAISE(ABORT,'injected failure'); END;`,
    );
    await assert.rejects(
      ingest(db, "u1", m, rows, false, DEFAULT_SETTINGS, now),
    );
    for (const table of [
      "listings",
      "listing_snapshots",
      "monitor_sightings",
      "opportunities",
      "alerts",
      "notification_outbox",
    ])
      assert.equal(
        sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n,
        0,
        `${target}: ${table} must roll back`,
      );
    sql.exec("DROP TRIGGER fail_ingest");
    const result = await ingest(
      db,
      "u1",
      m,
      rows,
      false,
      DEFAULT_SETTINGS,
      now,
    );
    assert.equal(result.discoveries, 21);
    assert.equal(result.alerts, 21);
    const retry = await ingest(
      db,
      "u1",
      m,
      rows,
      false,
      DEFAULT_SETTINGS,
      new Date(+now + 60000),
    );
    assert.equal(retry.alerts, 0);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM alerts").get()!.n, 21);
    assert.equal(
      sql.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get()!.n,
      21,
    );
    sql.close();
  }
});

test("cotação ausente ou parcial preserva referência para queda de preço, inclusive histórico legado", async () => {
  const original = materialize({ ...listing(), price: 3000 }, true, now);
  for (const missing of [
    { price: null },
    { price: 500, description: "Entrada de R$500 + parcelas" },
  ]) {
    const gap = materialize(
      { ...original, ...missing },
      false,
      new Date(+now + 60000),
      original,
    );
    assert.equal(gap.price, missing.price);
    assert.equal(gap.lastValidPrice, 3000);
    const drop = materialize(
      { ...original, price: 2200 },
      false,
      new Date(+now + 120000),
      gap,
    );
    assert.equal(drop.previousPrice, 3000);
    assert.equal(drop.lastValidPrice, 2200);
    assert.equal(
      analyze(drop, [], DEFAULT_SETTINGS, policy, now).event,
      "price_drop",
    );
  }
  const { db, sql, createUser } = database();
  await createUser();
  const m = await saveMonitor(db, "u1", input(policy));
  await ingest(db, "u1", m, [original], true, DEFAULT_SETTINGS, now);
  await ingest(
    db,
    "u1",
    m,
    [{ ...original, price: null }],
    false,
    DEFAULT_SETTINGS,
    new Date(+now + 60000),
  );
  sql.exec("UPDATE listings SET data=json_remove(data,'$.lastValidPrice')");
  const result = await ingest(
    db,
    "u1",
    m,
    [{ ...original, price: 2200 }],
    false,
    DEFAULT_SETTINGS,
    new Date(+now + 120000),
  );
  assert.equal(result.alerts, 1);
  assert.equal((await getListings(db, "u1"))[0].previousPrice, 3000);
  assert.equal((await getAlerts(db, "u1"))[0].event, "price_drop");
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS n FROM listing_snapshots WHERE price IS NULL",
      )
      .get()!.n,
    1,
  );
  sql.close();
});

test("calibração usa previsão automática original, sem hipóteses manuais nem realimentação", () => {
  const row = listing();
  const pool = Array.from({ length: 5 }, (_, i) => ({
    ...row,
    id: `sale-${i}`,
  }));
  const purchases: Purchase[] = pool.map((l, i) => ({
    id: `p-${i}`,
    listingId: l.id,
    title: l.title,
    paid: 2000,
    costs: 0,
    boughtAt: now.toISOString(),
    soldAt: now.toISOString(),
    soldFor: 3000,
    estimated: 10000,
    estimateSource: "manual",
    automaticBaseEstimate: 3000,
  }));
  assert.equal(calibrationFactor(row, pool, purchases), 1);
  assert.equal(
    calibrationFactor(
      row,
      pool,
      purchases.map((p) => ({ ...p, estimateSource: undefined })),
    ),
    1,
  );
  const automatic = purchases.map((p) => ({
    ...p,
    estimateSource: "automatic" as const,
    estimated: 2400,
    soldFor: 2400,
  }));
  assert.equal(calibrationFactor(row, pool, automatic), 0.8);
  assert.equal(
    calibrationFactor(
      row,
      pool,
      automatic.map((p) => ({ ...p, estimateSource: "hybrid" as const })),
    ),
    0.8,
  );
  const comparable = fixture();
  const base = priceListing(
    comparable.listing,
    comparable.pool,
    DEFAULT_SETTINGS,
    now,
  );
  const adjusted = priceListing(
    comparable.listing,
    comparable.pool,
    DEFAULT_SETTINGS,
    now,
    0.8,
  );
  assert.ok(base.automaticBase! > 0);
  assert.equal(adjusted.automaticBase, base.automaticBase);
  assert.ok(adjusted.quickSale! < base.quickSale!);
});

test("fronteiras de ROI/idade são exatas e níveis automáticos nunca invertem", () => {
  const low = { ...policy, maxPrice: 1000, strongPrice: 500, ultraPrice: null };
  const a = analyze(listing(), [], DEFAULT_SETTINGS, low, now);
  assert.ok(a.ultraPurchasePrice! <= a.strongPurchasePrice!);
  const high = {
    ...policy,
    maxPrice: 1000,
    strongPrice: null,
    ultraPrice: 950,
  };
  const b = analyze(listing(), [], DEFAULT_SETTINGS, high, now);
  assert.ok(b.ultraPurchasePrice! <= b.strongPurchasePrice!);
  const boundary = analyze(
    { ...listing(), price: 100.01 },
    [],
    DEFAULT_SETTINGS,
    {
      ...policy,
      expectedQuickSalePrice: 120.01,
      minProfit: 0,
      minRoi: 20,
      minScore: 0,
      costs: { ...DEFAULT_SETTINGS },
    },
    now,
  );
  assert.equal(boundary.roi, 20);
  assert.equal(boundary.eligible, false);
  assert.equal(
    analyze(
      {
        ...listing(),
        publishedAt: new Date(+now - 15 * 60000 - 1).toISOString(),
      },
      [],
      DEFAULT_SETTINGS,
      { ...policy, maxListingAgeMinutes: 15 },
      now,
    ).eligible,
    false,
  );
});
test("pausa drena snapshot já criado sem novo disparo ou alerta", async () => {
  const { db, createUser } = database();
  await createUser();
  const m = await saveMonitor(db, "u1", input(policy));
  await enqueue(db, "u1", true);
  let posts = 0,
    polls = 0;
  const provider = {
    id: "brightdata",
    capabilities: {
      discovery: true,
      publicationTime: true,
      locationFilter: false,
      availability: false,
      images: true,
    },
    healthCheck: async () => ({ ok: true, message: "fixture" }),
    search: async (r: import("../providers/contract").SearchRequest) => {
      if (!r.cursor) {
        posts++;
        return {
          items: [],
          complete: false,
          cursor: "s_fixture",
          warnings: [],
        };
      }
      polls++;
      return { items: [listing()], complete: true, warnings: [] };
    },
    getListing: async () => null,
    getImages: () => [],
    getSellerInfo: () => ({ id: null }),
    getPublicationTime: () => ({ value: null, confidence: 0 }),
  };
  assert.equal((await runOne(db, "u1", () => provider)).status, "waiting");
  await db
    .prepare(
      "UPDATE monitors SET config=json_set(config,'$.active',json('false')),active=0 WHERE id=?",
    )
    .bind(m.id)
    .run();
  await db.prepare("UPDATE jobs SET available_at='2000-01-01T00:00:00Z'").run();
  assert.equal((await runOne(db, "u1", () => provider)).status, "done");
  assert.equal(posts, 1);
  assert.equal(polls, 1);
  assert.equal((await getListings(db, "u1")).length, 1);
  assert.equal((await getAlerts(db, "u1")).length, 0);
});

test("ID já observado sem alerta não reaparece como descoberta nova em outro monitor", async () => {
  const { db, createUser } = database();
  await createUser();
  const row = listing();
  await ingest(db, "u1", policy, [row], false, DEFAULT_SETTINGS, now, false);
  const result = await ingest(
    db,
    "u1",
    { ...policy, id: "outro-monitor" },
    [row],
    false,
    DEFAULT_SETTINGS,
    new Date(+now + 1000),
  );
  assert.equal(result.discoveries, 0);
  assert.equal(result.alerts, 0);
});

test("contador diário usa banco real completo, não o limite de 100 alertas da lista", async () => {
  const { db, createUser } = database();
  await createUser();
  const row = listing();
  await listingStatement(db, "u1", row).run();
  for (let i = 0; i < 125; i++)
    await db
      .prepare(
        "INSERT INTO alerts (id,user_id,listing_id,event_key,created_at,data,read) VALUES (?,'u1',?,?,?, ?,0)",
      )
      .bind(
        `a${i}`,
        row.id,
        `event${i}`,
        new Date().toISOString(),
        JSON.stringify({ id: `a${i}`, listingId: row.id, demo: false }),
      )
      .run();
  const result = await state(db, "u1");
  assert.equal(result.alerts.length, 100);
  assert.equal(result.alertsToday, 125);
});
