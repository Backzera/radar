import test from "node:test";
import assert from "node:assert/strict";
import { freshness, canonicalUrl, discoveryDelays } from "../core/freshness";
import { normalize, priceAnomalies, expandQueries } from "../core/normalize";
import {
  priceListing,
  percentile,
  comparableSimilarity,
} from "../core/pricing";
import { analyze, matchesMonitor, distanceKm } from "../core/opportunity";
import { nextInterval, retryDelay, selectQueries } from "../core/scheduler";
import { materialize } from "../server/ingestion";
import { DEFAULT_SETTINGS } from "../core/types";
import { fixture, monitor, now } from "./fixtures";
test("recência distingue publicação e descoberta", () => {
  assert.equal(freshness(null, 0, now).freshness, "unknown");
  assert.equal(freshness("2026-09-01T00:00:00Z", 100, now).freshness, "old");
  assert.equal(
    freshness("2026-09-10T14:56:00Z", 100, now).freshness,
    "just_published",
  );
  assert.equal(freshness("2026-09-10T12:00:00Z", 100, now).freshness, "recent");
});
test("datas futuras, inválidas e confiança fraca não ganham urgência", () => {
  for (const d of ["2026-10-10T00:00:00Z", "oops"])
    assert.equal(freshness(d, 100, now).freshness, "invalid");
  assert.equal(freshness(now.toISOString(), 30, now).freshness, "unknown");
});
test("fronteiras 15 minutos e 24h são explícitas", () => {
  assert.equal(
    freshness(new Date(+now - 15 * 60000).toISOString(), 100, now).freshness,
    "just_published",
  );
  assert.equal(
    freshness(new Date(+now - 1441 * 60000).toISOString(), 100, now).freshness,
    "old",
  );
});
test("normalização extrai iPhone quinze e atributos sem inventar", () => {
  const p = normalize({
    title: "iphone quinze azul 128 GB pouco uso",
    description:
      "Bateria 86%, acompanha caixa, sem carregador, Face ID funcionando.",
  });
  assert.equal(p.model, "iPhone 15");
  assert.equal(p.storage, 128);
  assert.equal(p.batteryHealth, 86);
  assert.equal(p.box, true);
  assert.equal(p.charger, false);
  assert.equal(p.faceId, "working");
});
test("variantes desconhecidas e diferentes não se misturam", () => {
  const p = normalize({ title: "iPhone 15", description: "usado" });
  assert.equal(p.storage, null);
  assert.equal(p.key, null);
  const ps = normalize({ title: "PS5", description: "usado" });
  assert.equal(ps.edition, null);
  assert.equal(ps.key, null);
  const { listing } = fixture();
  const max = {
    ...listing,
    id: "other",
    product: normalize({
      title: "iPhone 15 Pro Max 256 GB",
      description: "pouco uso",
    }),
  };
  assert.equal(comparableSimilarity(listing, max).score, 0);
});
test("negação sem defeitos não danifica condição", () => {
  assert.notEqual(
    normalize({
      title: "PS5 Slim Digital usado",
      description: "sem defeitos, impecável",
    }).condition,
    "damaged",
  );
});
test("entrada, parcela, caixa e acessórios bloqueiam preço integral", () => {
  for (const title of [
    "iPhone 15 entrada de 500",
    "iPhone 15 12x de 250",
    "somente caixa iPhone 15",
    "Controle PS5 DualSense para PS5 Slim Digital",
  ])
    assert.ok(priceAnomalies(title, "").length, title);
  assert.equal(
    priceAnomalies("PS5 Slim Digital", "acompanha controle").length,
    0,
  );
});
test("pricing é robusto a outliers e não compara o próprio anúncio", () => {
  const { listing, pool } = fixture();
  const bad = {
    ...pool[0],
    id: "bad",
    externalId: "bad",
    sellerId: "bad",
    fingerprint: "bad",
    price: 500,
  };
  const p = priceListing(
    listing,
    [...pool, bad, listing],
    DEFAULT_SETTINGS,
    now,
  );
  assert.equal(p.count, 10);
  assert.equal(p.comparables.find((c) => c.id === "bad")?.included, false);
  assert.ok(p.quickSale! > 2700);
  assert.ok(!p.comparables.find((c) => c.id === listing.id));
});
test("MAD zero não mantém preços absurdos", () => {
  const { listing, pool } = fixture();
  const same = pool
    .filter((p) => p.product.key === listing.product.key)
    .map((l, i) => ({ ...l, price: i === 9 ? 500 : 3000 }));
  assert.equal(priceListing(listing, same, DEFAULT_SETTINGS, now).count, 9);
});
test("dois comparáveis não permitem estimativa de venda rápida", () => {
  const { listing, pool } = fixture();
  const p = priceListing(listing, pool.slice(0, 2), DEFAULT_SETTINGS, now);
  assert.equal(p.quickSale, null);
  assert.ok(p.confidence < 50);
});
test("novo/usado e dados reais/demo são separados", () => {
  const { listing, pool } = fixture();
  assert.equal(
    priceListing(
      listing,
      pool.map((l) => ({ ...l, demo: true })),
      DEFAULT_SETTINGS,
      now,
    ).count,
    0,
  );
  assert.equal(
    priceListing(
      listing,
      pool.map((l) => ({ ...l, product: { ...l.product, condition: "new" } })),
      DEFAULT_SETTINGS,
      now,
    ).count,
    0,
  );
});
test("comparáveis repetidos por fingerprint não inflam amostra", () => {
  const { listing, pool } = fixture();
  const repeats = Array.from({ length: 15 }, (_, i) => ({
    ...pool[0],
    id: `r${i}`,
    sellerId: null,
    fingerprint: "same",
  }));
  assert.equal(priceListing(listing, repeats, DEFAULT_SETTINGS, now).count, 1);
});
test("lucro considera todos os custos e base do ROI explícita", () => {
  const { listing, pool } = fixture();
  const a = analyze(
    listing,
    pool,
    {
      ...DEFAULT_SETTINGS,
      transport: 100,
      maintenance: 30,
      cleaning: 15,
      packaging: 15,
      feePct: 10,
    },
    monitor,
    now,
  );
  const costs = 100 + 30 + 15 + 15 + a.pricing.quickSale! * 0.1;
  assert.ok(Math.abs(a.totalCosts! - costs) < 0.02);
  assert.ok(
    Math.abs(a.netProfit! - (a.pricing.quickSale! - listing.price! - costs)) <
      0.02,
  );
  assert.ok(a.capitalRoi! < a.roi!);
  assert.equal(
    a.score,
    a.contributions.reduce((s, c) => s + c.points, 0),
  );
});
test("baseline e data desconhecida suprimem alerta automático/manual", () => {
  const { listing, pool } = fixture();
  for (const m of [
    monitor,
    { ...monitor, mode: "manual" as const, manualPrice: 5000 },
  ]) {
    assert.equal(
      analyze({ ...listing, baseline: true }, pool, DEFAULT_SETTINGS, m, now)
        .notificationEligible,
      false,
    );
    assert.equal(
      analyze({ ...listing, publishedAt: null }, pool, DEFAULT_SETTINGS, m, now)
        .eligible,
      false,
    );
  }
});
test("disponibilidade desconhecida permite alerta; liquidez exigida continua bloqueando", () => {
  const { listing, pool } = fixture();
  assert.equal(
    analyze(
      { ...listing, availability: "unknown" },
      pool,
      DEFAULT_SETTINGS,
      monitor,
      now,
    ).eligible,
    true,
  );
  assert.equal(
    analyze(
      listing,
      pool,
      DEFAULT_SETTINGS,
      { ...monitor, minLiquidity: 80 },
      now,
    ).eligible,
    false,
  );
});
test("manual não pode contornar preço de entrada", () => {
  const { listing, pool } = fixture();
  const a = analyze(
    { ...listing, title: "iPhone 15 entrada 500", price: 500 },
    pool,
    DEFAULT_SETTINGS,
    { ...monitor, mode: "manual", manualPrice: 1000, maxRisk: 100 },
    now,
  );
  assert.equal(a.eligible, false);
  assert.equal(a.netProfit, null);
  assert.equal(a.score, 0);
});
test("filtros de região, negativos e faixa de preço", () => {
  const { listing } = fixture();
  assert.equal(matchesMonitor(listing, monitor), true);
  assert.equal(matchesMonitor(listing, { ...monitor, maxPrice: 100 }), true);
  assert.equal(
    analyze(listing, [], DEFAULT_SETTINGS, { ...monitor, maxPrice: 100 }, now)
      .eligible,
    false,
  );
  assert.equal(
    matchesMonitor(listing, { ...monitor, city: "São Paulo" }),
    false,
  );
  assert.equal(
    matchesMonitor(listing, { ...monitor, negatives: ["iphone"] }),
    false,
  );
  assert.equal(
    matchesMonitor(
      { ...listing, latitude: null },
      { ...monitor, latitude: -25, longitude: -49 },
    ),
    false,
  );
  assert.equal(distanceKm(0, 0, 0, 0), 0);
});
test("alta depois de queda não preserva evento price drop", () => {
  const { listing } = fixture();
  const first = { ...listing, price: 3000 };
  const down = materialize({ ...first, price: 2200 }, false, now, first);
  assert.equal(down.previousPrice, 3000);
  const up = materialize({ ...down, price: 2500 }, false, now, down);
  assert.equal(up.previousPrice, null);
  assert.equal(up.priceChangedAt, null);
});
test("outro provider não rejuvenesce publicação conhecida", () => {
  const { listing } = fixture();
  const changed = materialize(
    { ...listing, publishedAt: now.toISOString(), provider: "other" },
    false,
    now,
    listing,
  );
  assert.equal(changed.publishedAt, listing.publishedAt);
  assert.equal(changed.firstSeenAt, listing.firstSeenAt);
  assert.equal(changed.seenBy.length, 2);
});
test("URL canônica deduplica parâmetros e domínio móvel não tem falso ID", () => {
  assert.equal(
    canonicalUrl("https://www.facebook.com/marketplace/item/123/?ref=share"),
    "https://www.facebook.com/marketplace/item/123/",
  );
});
test("métricas de atraso excluem baseline e data desconhecida", () => {
  const { listing } = fixture();
  const d = discoveryDelays([
    listing,
    { ...listing, baseline: true },
    { ...listing, publishedAt: null },
  ]);
  assert.equal(d.samples, 1);
  assert.equal(d.medianSeconds, 180);
});
test("scheduler respeita piso, backoff, jitter e budget de queries", () => {
  assert.ok(nextInterval(60, 10, 0, () => 0) >= 60);
  assert.ok(nextInterval(120, 0, 2, () => 0) > 120);
  assert.equal(
    retryDelay(2, 180, () => 0),
    180,
  );
  assert.ok(expandQueries("PS5", Array(20).fill("alias")).length <= 6);
  assert.equal(
    selectQueries(
      [
        { text: "poor", runs: 100, discoveries: 0 },
        { text: "new", runs: 0, discoveries: 0 },
      ],
      1,
    )[0],
    "new",
  );
});
test("percentis usam interpolação e amostra vazia permanece nula", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([10, 20, 30, 40], 0.25), 17.5);
});
test("disponibilidade desconhecida contribui com confiança reduzida e pode alertar", () => {
  const { listing, pool } = fixture();
  const unknown = pool.map((l) => ({ ...l, availability: "unknown" as const }));
  const pricing = priceListing(listing, unknown, DEFAULT_SETTINGS, now);
  assert.ok(pricing.quickSale);
  assert.ok(pricing.confidence <= 65);
  assert.equal(
    analyze(
      { ...listing, availability: "unknown" },
      unknown,
      DEFAULT_SETTINGS,
      monitor,
      now,
    ).eligible,
    true,
  );
  const stale = unknown.map((l) => ({
    ...l,
    lastSeenAt: new Date(+now - 8 * 86400000).toISOString(),
  }));
  assert.equal(priceListing(listing, stale, DEFAULT_SETTINGS, now).count, 0);
});
