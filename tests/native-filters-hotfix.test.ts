import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./fixtures";
import { createHandler } from "../server/http";
import { SelfScraperProvider } from "../providers/self-scraper";
import type { MarketplaceProvider } from "../providers/contract";
import { getMonitors } from "../server/store";
import { bootstrap } from "../server/bootstrap";
import { ensureUser } from "../server/seed";

// A fonte paga Bright Data (filtros nativos/confirmação paga/snapshot assíncrono)
// foi substituída pelo SelfScraperProvider. Ele NÃO expõe filtros nativos: a
// filtragem de cidade, raio, idade do anúncio e preço é LOCAL, feita pelo
// pipeline (core/opportunity.ts + server/ingestion.ts). Estes testes provam que
// a fonte devolve tudo e o pipeline é quem filtra.
//
// Casos aposentados do arquivo Bright Data (não há equivalente no scraper próprio):
//  - exactNativeFilters/nativeRadius/nativePublicationPolicy com enum/unidade do
//    contrato, conversão km/milhas/metros, fingerprint do contrato e confirmação
//    administrativa (admin/provider/filters): o scraper não publica schema, logo
//    não há filtro nativo a validar. A cobertura dessas funções puras permanece
//    em providers/search-policy e no restante da suíte.

const cfg = {
  AUTH_MODE: "local-development",
  ALLOW_LOCAL_DEV_AUTH: "true",
  RADAR_ADMIN_IDS: "local-radar",
  COLLECTION_ENABLED: "true",
  PILOT_MODE: "true",
  SCRAPER_URL: "http://localhost:8000",
  WORKER_TOKEN: "test-worker-token-".repeat(4),
};
function req(path: string, body?: unknown) {
  return new Request("http://localhost:5173/api/v1/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: "http://localhost:5173",
      "content-type": "application/json",
      ...(path === "worker/tick"
        ? { authorization: "Bearer " + cfg.WORKER_TOKEN }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
// Item no formato do microserviço de scraping (POST {SCRAPER_URL}/search).
function serviceItem(id: string, over: Record<string, unknown> = {}) {
  return {
    listingId: id,
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    title: "iPhone 14 128 GB",
    price: 2000,
    currency: "BRL",
    location: "Curitiba, Paraná, Brazil",
    images: [],
    publishedAt: new Date().toISOString(),
    sellerId: "seller-" + id,
    condition: "used",
    ...over,
  };
}
function scraper() {
  const calls: { path: string; body: Record<string, unknown> | null }[] = [];
  let items: unknown[] = [];
  const transport = (async (input, init) => {
    const u = new URL(String(input));
    calls.push({
      path: u.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (u.pathname.endsWith("/search")) return Response.json({ items });
    throw new Error("Rota inesperada do scraper: " + u.pathname);
  }) as typeof fetch;
  return {
    calls,
    transport,
    setItems(v: unknown[]) {
      items = v;
    },
  };
}
function harness(transport: typeof fetch) {
  const d = database();
  const handler = createHandler(d.db, cfg, {
    development: true,
    provider: () =>
      new SelfScraperProvider({ baseUrl: cfg.SCRAPER_URL, maxRecords: 10 }, transport),
  });
  return { ...d, handler };
}
async function createMonitor(
  handler: (r: Request) => Promise<Response>,
  extras: Record<string, unknown> = {},
) {
  const r = await handler(
    req("searches", {
      requestKey: crypto.randomUUID(),
      config: {
        name: "iPhone 14",
        product: "iPhone 14",
        query: "iPhone 14",
        city: "Curitiba",
        intent: "personal",
        maxPrice: 2200,
        radiusKm: 30,
        intervalSeconds: 300,
        resultsPerSearch: 10,
        ...extras,
      },
    }),
  );
  assert.equal(r.status, 201, await r.clone().text());
}

test("Contrato: fonte própria é síncrona, sem filtros nativos, prepareQuery ou checkListing", async () => {
  const net = scraper();
  net.setItems([
    serviceItem("111"),
    { url: "https://example.com/x", title: "ignorar" }, // não é anúncio do Marketplace
  ]);
  const provider = new SelfScraperProvider(
    { baseUrl: cfg.SCRAPER_URL, maxRecords: 10 },
    net.transport,
  );
  // Sem filtros nativos: nenhum método de preparação/validação de consulta.
  const asContract: MarketplaceProvider = provider;
  assert.equal(typeof asContract.prepareQuery, "undefined");
  assert.equal(typeof asContract.checkListing, "undefined");

  const health = await provider.healthCheck();
  assert.equal(health.ok, true);
  assert.equal(health.dataset, "self-scraper");
  assert.deepEqual(health.methods, { keyword: true, search_url: true });
  assert.equal(health.schemas, undefined); // não há schema de filtros nativos

  // search() devolve o resultado completo numa única chamada (sem cursor/poll).
  const result = await provider.search({
    query: "iphone 14",
    city: "Curitiba",
    radiusKm: 30,
    sequence: 0,
    limit: 10,
  });
  assert.equal(result.complete, true);
  assert.equal(result.cursor, undefined);
  assert.equal(result.received, 2);
  assert.equal(result.rejected, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].externalId, "111");
  assert.equal(result.items[0].provider, "brightdata"); // rótulo interno mantido
  assert.equal(result.items[0].city, "Curitiba");
  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].path, "/search");
});

test("Filtragem local: cidade, orçamento e idade são aplicados pelo pipeline, não pela fonte", async () => {
  const net = scraper();
  const h = harness(net.transport);
  try {
    await createMonitor(h.handler, { maxListingAgeMinutes: 1440 });
    const m = (await getMonitors(h.db, "local-radar"))[0];
    assert.deepEqual(m.providerFilters, {}); // nenhum filtro nativo é injetado
    await h.handler(req("admin/provider/check", {}));

    const stale = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    net.setItems([
      serviceItem("111", { price: 2000 }), // ok: dentro do orçamento/cidade/recência
      serviceItem("222", { price: 5000 }), // fora do orçamento (maxPrice 2200)
      serviceItem("333", { price: 2000, publishedAt: stale }), // fora da janela (24h)
      serviceItem("444", { price: 2000, location: "São Paulo, SP, Brazil" }), // outra cidade
    ]);
    await h.handler(req("scan", { monitorId: m.id, confirmConsumption: true }));
    assert.equal((await h.handler(req("worker/tick", {}))).status, 200);

    // A fonte devolveu os quatro (um único POST /search): nada foi filtrado nela.
    assert.equal(net.calls.length, 1);
    assert.equal(net.calls[0].body!.city, "Curitiba");
    assert.equal(net.calls[0].body!.radiusKm, 30);
    assert.match(String(net.calls[0].body!.query), /iphone/i);
    assert.equal(
      h.sql.prepare("SELECT COUNT(*) n FROM listings WHERE demo=0").get()!.n,
      4,
    );
    assert.equal(
      h.sql.prepare("SELECT status FROM provider_runs").get()!.status,
      "completed",
    );

    // A vitrine ativa mostra apenas o anúncio que passou nos filtros locais.
    const feed = (await (
      await h.handler(req("results?filter=baseline&limit=25"))
    ).json()) as {
      total: number;
      items: { listing: { externalId: string; price: number; city: string } }[];
    };
    assert.equal(feed.total, 1);
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].listing.externalId, "111");
    assert.equal(feed.items[0].listing.price, 2000);
    assert.equal(feed.items[0].listing.city, "Curitiba");
    // Baseline não gera alerta.
    assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM alerts").get()!.n, 0);

    // Nenhum payload bruto da fonte nem segredo vaza no JSON servido.
    const serialized = JSON.stringify(feed);
    assert.equal(serialized.includes(cfg.SCRAPER_URL), false);
    assert.equal(serialized.includes(cfg.WORKER_TOKEN), false);
    assert.equal(serialized.includes("seller-111"), false); // sellerId é removido no resumo
  } finally {
    h.sql.close();
  }
});

test("Bootstrap: a fonte própria anuncia filtragem local (sem recência/raio/cidade nativos)", async () => {
  const net = scraper();
  const h = harness(net.transport);
  try {
    await ensureUser(h.db, "local-radar");
    await h.handler(req("admin/provider/check", {}));
    const b = await bootstrap(
      h.db,
      { kind: "user", userId: "local-radar", admin: true },
      cfg,
      true,
    );
    assert.equal(b.service.ready, true);
    assert.deepEqual(b.service.methods, { keyword: true, search_url: true });
    // Filtros locais: a fonte não confirma recência, raio ou cidade nativos.
    assert.equal(b.service.nativeRecency, "local_only");
    assert.equal(b.service.nativeRadiusConfirmed, false);
    assert.equal(b.service.cityFilter, false);
    assert.equal(b.service.radiusFilter, false);
  } finally {
    h.sql.close();
  }
});
