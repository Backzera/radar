import test from "node:test";
import assert from "node:assert/strict";
import { database, fixture, monitor } from "./fixtures";
import { ensureUser } from "../server/seed";
import { saveMonitor } from "../server/service";
import { listingStatement } from "../server/store";
import { getFeed } from "../server/feed";
import { normalize, expandQueries } from "../core/normalize";
import { analyze } from "../core/opportunity";
import { DEFAULT_SETTINGS, type Listing } from "../core/types";

const recent = new Date();
function listing(
  title: string,
  days: number,
  id: string,
  overrides: Partial<Listing> = {},
): Listing {
  const base = fixture().listing;
  const raw = {
    ...base,
    id,
    externalId: id,
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    title,
    description: "Usado em bom estado, funcionando.",
    city: "Curitiba",
    price: 1800,
    sellerId: id,
    fingerprint: id,
    baseline: true,
    publishedAt: new Date(+recent - days * 86400000).toISOString(),
    publicationStatus: "valid" as const,
    publicationConfidence: 100,
    lastSeenAt: recent.toISOString(),
    ...overrides,
  };
  return { ...raw, product: normalize(raw) };
}
test("2.0: vitrine não inclui modelo errado, peça, anúncio antigo, sem data, vendido ou fora do orçamento", async () => {
  const { db, sql } = database();
  try {
    await ensureUser(db, "u1");
    await saveMonitor(db, "u1", {
      name: "iPhone 14",
      product: "iPhone 14",
      query: "iPhone 14",
      intent: "personal",
      city: "Curitiba",
      maxPrice: 2200,
      maxRisk: 100,
      maxListingAgeMinutes: 10080,
    });
    const rows = [
      listing("iPhone 14 128GB", 1, "101"),
      listing("iPhone 14 Pro 128GB", 1, "102"),
      listing("iPhone 13 128GB", 1, "103"),
      listing("iPhone 13 Pro Max para peças", 1, "104"),
      listing("iPhone 14 128GB", 35, "105"),
      listing("iPhone 14 128GB", 1, "106", {
        publishedAt: null,
        publicationStatus: "missing",
      }),
      listing("iPhone 14 128GB", 1, "107", { availability: "sold" }),
      listing("iPhone 14 128GB", 1, "108", { price: 2400 }),
      listing("iPhone 14 plus 128GB", 1, "109"),
      listing("iPhone 14 128GB para peças", 1, "110"),
      listing("iPhone 14 128GB", 1, "111", { city: "São Vicente" }),
    ];
    for (const l of rows) await listingStatement(db, "u1", l).run();
    const feed = await getFeed(db, "u1");
    assert.deepEqual(
      feed.items.map((o) => o.listing.id),
      ["101"],
    );
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM listings").get()!.n,
      rows.length,
      "Histórico preservado",
    );
  } finally {
    sql.close();
  }
});
test("2.0: orçamento e alerta respeitam sete dias mesmo com limite legado ilimitado", () => {
  const l = listing("iPhone 14 128GB", 35, "201", { baseline: false });
  const m = {
    ...monitor,
    query: "iPhone 14",
    intent: "personal" as const,
    maxRisk: 100,
    maxListingAgeMinutes: null,
  };
  const a = analyze(l, [l], DEFAULT_SETTINGS, m, recent);
  assert.equal(a.budgetEligible, false);
  assert.equal(a.notificationEligible, false);
});
test("2.0: primeira coleta pode ter margem aprovada sem fingir novidade", () => {
  const l = listing("iPhone 14 128GB", 1, "202");
  const m = {
    ...monitor,
    query: "iPhone 14",
    intent: "resale" as const,
    mode: "manual" as const,
    expectedQuickSalePrice: 2500,
    maxPrice: 2200,
    minProfit: 100,
    minScore: 0,
    minRoi: 0,
    maxRisk: 100,
    maxListingAgeMinutes: 10080,
  };
  const a = analyze(l, [l], DEFAULT_SETTINGS, m, recent);
  assert.equal(a.eligible, true);
  assert.equal(a.notificationEligible, false);
  assert.equal(a.event, "baseline");
});
test("2.0: nomes alternativos mantêm versão exata, sem palavras genéricas", () => {
  const aliases = expandQueries("PS5 Slim Digital");
  assert.ok(aliases.length > 1);
  assert.ok(aliases.every((q) => q.includes("slim") && q.includes("digital")));
  assert.ok(!aliases.includes("console sony"));
  assert.ok(expandQueries("iPhone 14").includes("apple iphone 14"));
});
test("2.0: preço muito baixo pede checagem sem rejeição por si só", () => {
  const l = listing("iPhone 14 128GB", 0.01, "203", {
    baseline: false,
    price: 700,
    availability: "active",
  });
  const pool = Array.from({ length: 8 }, (_, i) =>
    listing("iPhone 14 128GB", 1, String(i + 300), { price: 2500 + i * 10 }),
  );
  const m = {
    ...monitor,
    query: "iPhone 14",
    intent: "personal" as const,
    maxPrice: 2200,
  };
  assert.equal(
    analyze(l, pool, DEFAULT_SETTINGS, m, recent).budgetEligible,
    true,
  );
});

test("2.0: datas ausentes, futuras e não confiáveis não viram oportunidades; 24h é respeitado", async () => {
  const { publicationWindow } = await import("../core/selection");
  const m = { ...monitor, maxListingAgeMinutes: 1440 };
  assert.equal(
    publicationWindow(listing("iPhone 14", 2, "910"), m, recent).valid,
    false,
  );
  assert.equal(
    publicationWindow(listing("iPhone 14", 0.5, "911"), m, recent).valid,
    true,
  );
  assert.equal(
    publicationWindow(listing("iPhone 14", -1, "912"), m, recent).valid,
    false,
  );
  assert.equal(
    publicationWindow(
      listing("iPhone 14", 0.5, "913", { publicationStatus: "untrusted" }),
      m,
      recent,
    ).valid,
    false,
  );
});

test("2.0: includeUndated mostra anúncio sem data (rotulado), sem fingir recência; antigo/futuro/fora do teto seguem fora", () => {
  const base = {
    ...monitor,
    query: "iPhone 14",
    intent: "resale" as const,
    minPrice: 0,
    maxPrice: 2200,
    maxRisk: 100,
    minScore: 0,
    minRoi: 0,
    maxListingAgeMinutes: 10080,
  };
  const undated = listing("iPhone 14 128GB", 0, "u1", {
    publishedAt: null,
    publicationStatus: "missing",
    publicationConfidence: 0,
    price: 1800,
    firstSeenAt: recent.toISOString(),
  });
  // Sem a opção, anúncio sem data continua fora da vitrine.
  assert.equal(
    analyze(undated, [undated], DEFAULT_SETTINGS, base, recent).budgetEligible,
    false,
  );
  // Com includeUndated: entra na vitrine, mas sem fingir recência nem alertar.
  const on = { ...base, includeUndated: true };
  const a = analyze(undated, [undated], DEFAULT_SETTINGS, on, recent);
  assert.equal(a.budgetEligible, true);
  assert.equal(a.publicationEligible, false);
  assert.equal(a.notificationEligible, false);
  assert.ok(a.displayExpiresAt && a.displayExpiresAt > recent.toISOString());
  // Data comprovadamente antiga segue fora mesmo com includeUndated.
  const old = listing("iPhone 14 128GB", 60, "u2", { price: 1800 });
  assert.equal(
    analyze(old, [old], DEFAULT_SETTINGS, on, recent).budgetEligible,
    false,
  );
  // Sem data mas acima do teto também não entra.
  const pricey = listing("iPhone 14 128GB", 0, "u3", {
    publishedAt: null,
    publicationStatus: "missing",
    publicationConfidence: 0,
    price: 5000,
    firstSeenAt: recent.toISOString(),
  });
  assert.equal(
    analyze(pricey, [pricey], DEFAULT_SETTINGS, on, recent).budgetEligible,
    false,
  );
});
