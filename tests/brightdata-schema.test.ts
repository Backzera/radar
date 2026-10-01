import test from "node:test";
import assert from "node:assert/strict";
import { BrightDataProvider, mapFacebook } from "../providers/brightdata";
import { inspectBrightDataMetadata } from "../providers/brightdata-schema";
import { ProviderError } from "../providers/contract";
import { providerQuery, type ProviderQuery } from "../core/provider-query";
import { providerFiltersSchema } from "../server/validation";
import { enqueueTest, runOne } from "../server/worker";
import { diagnostics } from "../server/diagnostics";
import { getListings, getMonitors } from "../server/store";
import { saveMonitor } from "../server/service";
import { database } from "./fixtures";
import { nativeMetadata, nativeListing } from "./brightdata-fixtures";

test("fingerprint ignora ordem e descrições; enum contraditório ou tipo ausente fica indisponível", async () => {
  const metadata = nativeMetadata();
  const original = await inspectBrightDataMetadata(
    metadata,
    "gd_lvt9iwuh6fbcwmx1a",
  );
  const method = metadata[0].scrapers.discover_by_keyword;
  method.input_schema[1].description = "Translated description";
  method.output_fields.reverse();
  method.input_schema.reverse();
  (
    method.input_schema.find((f) => f.name === "date_listed")!.enum as string[]
  ).reverse();
  const reordered = await inspectBrightDataMetadata(
    metadata,
    "gd_lvt9iwuh6fbcwmx1a",
  );
  assert.equal(
    reordered.schemas?.keyword?.fingerprint,
    original.schemas?.keyword?.fingerprint,
  );
  method.input_schema.find((f) => f.name === "date_listed")!.enum = [1, 7];
  const bad = await inspectBrightDataMetadata(metadata, "gd_lvt9iwuh6fbcwmx1a");
  assert.equal(
    bad.schemas?.keyword?.fields.find((f) => f.name === "date_listed")
      ?.supported,
    false,
  );
  delete method.input_schema.find((f) => f.name === "city")!.type;
  assert.equal(
    (await inspectBrightDataMetadata(metadata, "gd_lvt9iwuh6fbcwmx1a")).methods
      ?.keyword,
    false,
  );
});

test("Collect ausente na metadata não reserva nem chama POST", async () => {
  const metadata = nativeMetadata();
  delete metadata[0].scrapers.collect_by_url;
  let posts = 0,
    reservations = 0;
  const p = new BrightDataProvider(
    {
      apiKey: "fake",
      rightsConfirmed: "true",
      reserveCollectTrigger: async () => {
        reservations++;
        return true;
      },
    },
    async (_url, init) => {
      posts += Number(init?.method === "POST");
      return Response.json(metadata);
    },
  );
  await assert.rejects(p.getListing(nativeListing.url), /método necessário/);
  assert.equal(reservations, 0);
  assert.equal(posts, 0);
});

const config = {
  pilot: true,
  maxDailyTriggers: 5,
  maxRecords: 10,
  externalAlerts: false,
};
const searchUrl =
  "https://www.facebook.com/marketplace/curitiba/search/?query=iPhone%2015&sortBy=creation_time_descend";
const dataset = "gd_lvt9iwuh6fbcwmx1a";
function harness(metadata = nativeMetadata()) {
  const calls: { method: string; url: URL; body: unknown }[] = [];
  const provider = new BrightDataProvider(
    { apiKey: "fake-test-only", rightsConfirmed: "true", maxRecords: 10 },
    async (url, init) => {
      const u = new URL(String(url));
      calls.push({
        url: u,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json(
        u.pathname.endsWith("/scrapers")
          ? metadata
          : init?.method === "POST"
            ? { snapshot_id: "s_native" }
            : u.pathname.includes("/progress/")
              ? { status: "ready" }
              : [nativeListing],
      );
    },
  );
  return { provider, calls };
}
function request(filters: Record<string, string | number>) {
  return {
    query: "iPhone 15",
    city: "ignored-local-city",
    radiusKm: 999,
    sequence: 0,
    limit: 5,
    providerQuery: providerQuery("iPhone 15", "keyword", null, filters),
  };
}
for (const [label, filters] of Object.entries<Record<string, string | number>>({
  "keyword + cidade": { city: "Curitiba" },
  "keyword + cidade + raio": { city: "Curitiba", radius: 40 },
  "keyword + cidade + date_listed": {
    city: "Curitiba",
    date_listed: "Last 24 hours",
  },
  "todos os filtros": {
    city: "Curitiba",
    radius: 40,
    date_listed: "Last 24 hours",
  },
}))
  test(`contrato nativo: ${label} preserva payload e faz um único POST`, async () => {
    const { provider, calls } = harness();
    const q = request(filters);
    const pending = await provider.search(q);
    const done = await provider.search({ ...q, cursor: pending.cursor });
    assert.equal(done.items.length, 1);
    const posts = calls.filter((c) => c.method === "POST");
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body, [{ keyword: "iPhone 15", ...filters }]);
    assert.equal(posts[0].url.searchParams.get("discover_by"), "keyword");
    assert.equal(posts[0].url.searchParams.get("type"), "discover_new");
    assert.equal(posts[0].url.searchParams.get("limit_per_input"), "5");
    assert.equal(posts[0].url.searchParams.get("limit_multiple_results"), "5");
    assert.equal(
      calls.some((c) => c.url.pathname.endsWith("/scrape")),
      false,
    );
    assert.equal(done.items[0].city, "Pinhais");
    assert.equal(done.items[0].returnedLocation, nativeListing.location);
    assert.equal(
      done.items[0].publishedAt,
      nativeListing.listing_date.replace("Z", ".000Z"),
    );
  });
test("cidade obrigatória, radius e date_listed inválidos bloqueiam antes do POST", async () => {
  const invalid: Record<string, string | number>[] = [
    {},
    { city: "" },
    { city: "Curitiba", radius: -1 },
    { city: "Curitiba", radius: 0 },
    { city: "Curitiba", radius: 101 },
    { city: "Curitiba", radius: "40" },
    { city: "Curitiba", radius: NaN },
    { city: "Curitiba", date_listed: "Últimas 24 horas" },
    { city: "Curitiba", date_listed: "last 24 hours" },
  ];
  for (const filters of invalid) {
    const { provider, calls } = harness();
    await assert.rejects(
      provider.search(request(filters)),
      (e: unknown) =>
        e instanceof ProviderError && e.phase === "preflight" && !e.retryable,
    );
    assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  }
});
test("schema sem campo não recebe filtros inexistentes; obrigatoriedade vem da metadata", async () => {
  const metadata = nativeMetadata();
  metadata[0].scrapers.discover_by_keyword.input_schema = [
    { name: "keyword", type: "text", required: true },
  ];
  const { provider, calls } = harness(metadata);
  await assert.rejects(
    provider.search(request({ city: "Curitiba" })),
    /city.*não existe/,
  );
  assert.equal(
    calls.some((c) => c.method === "POST"),
    false,
  );
  await provider.search(request({}));
  assert.deepEqual(calls.find((c) => c.method === "POST")?.body, [
    { keyword: "iPhone 15" },
  ]);
});
test("metadata sem enum permite somente opção confirmada no painel e não inventa unidade/limites", async () => {
  const metadata = nativeMetadata();
  metadata[0].scrapers.discover_by_keyword.input_schema = [
    { name: "keyword", type: "text", required: true },
    { name: "city", type: "text", required: true },
    { name: "radius", type: "number" },
    { name: "date_listed", type: "text" },
  ];
  const { provider, calls } = harness(metadata);
  const health = await provider.healthCheck();
  const radius = health.schemas!.keyword!.fields.find(
    (f) => f.name === "radius",
  )!;
  assert.equal(radius.unit, undefined);
  assert.equal(radius.max, undefined);
  const recency = health.schemas!.keyword!.fields.find(
    (f) => f.name === "date_listed",
  )!;
  assert.equal(recency.supported, true);
  assert.equal(recency.inputEnabled, true);
  assert.equal(recency.enumPublished, false);
  assert.deepEqual(recency.options, ["Last 24 hours"]);
  assert.equal(recency.optionsSource, "account_panel");
  await assert.rejects(
    provider.search(request({ city: "Curitiba", date_listed: "Last 99 days" })),
    /opções/,
  );
  assert.equal(
    calls.some((c) => c.method === "POST"),
    false,
  );
});
test("mudança de contrato exige revisão; campos obrigatórios desconhecidos fecham o método", async () => {
  const original = await inspectBrightDataMetadata(nativeMetadata(), dataset);
  const changed = nativeMetadata();
  changed[0].scrapers.discover_by_keyword.input_schema[2].maximum = 50;
  const { provider, calls } = harness(changed);
  await assert.rejects(
    provider.search({
      ...request({ city: "Curitiba" }),
      providerQuery: providerQuery(
        "iPhone 15",
        "keyword",
        null,
        { city: "Curitiba" },
        original.schemas!.keyword!.fingerprint,
      ),
    }),
    /contrato.*mudou/,
  );
  assert.equal(
    calls.some((c) => c.method === "POST"),
    false,
  );
  changed[0].scrapers.discover_by_keyword.input_schema.push({
    name: "unexpected",
    type: "text",
    required: true,
  });
  assert.equal(
    (await inspectBrightDataMetadata(changed, dataset)).methods?.keyword,
    false,
  );
});
test("radius inteiro/texto preserva tipo declarado e rejeita limites/schema malformados", async () => {
  const metadata = nativeMetadata();
  metadata[0].scrapers.discover_by_keyword.input_schema[2].type = "integer";
  await assert.rejects(
    harness(metadata).provider.search(
      request({ city: "Curitiba", radius: 4.5 }),
    ),
    /inteiro/,
  );
  metadata[0].scrapers.discover_by_keyword.input_schema[2].type = "text";
  const { provider, calls } = harness(metadata);
  await provider.search(request({ city: "Curitiba", radius: "40" }));
  assert.deepEqual(calls.find((c) => c.method === "POST")?.body, [
    { keyword: "iPhone 15", city: "Curitiba", radius: "40" },
  ]);
  metadata[0].scrapers.discover_by_keyword.input_schema[2].maximum = "100";
  await assert.rejects(
    harness(metadata).provider.search(
      request({ city: "Curitiba", radius: "40" }),
    ),
    /Limites incompatíveis/,
  );
});
test("Discover by URL usa url/country exatos do contrato e mantém filtros do Facebook", async () => {
  const { provider, calls } = harness();
  const providerQuery: ProviderQuery = {
    type: "search_url",
    url: searchUrl,
    filters: { country: "Brazil" },
  };
  await provider.search({ ...request({}), providerQuery });
  const post = calls.find((c) => c.method === "POST")!;
  assert.deepEqual(post.body, [{ url: searchUrl, country: "Brazil" }]);
  assert.equal(post.url.searchParams.get("discover_by"), "url");
  await assert.rejects(
    provider.search({
      ...request({}),
      providerQuery: { type: "search_url", url: searchUrl },
    }),
    /country.*obrigatório/,
  );
  for (const url of [
    nativeListing.url,
    "http://localhost/marketplace/search/",
    "file:///test",
    "https://facebook.com/marketplace/search/?redirect_uri=https://evil.com",
  ]) {
    await assert.rejects(
      provider.search({
        ...request({}),
        providerQuery: { ...providerQuery, url },
      }),
      /URL/,
    );
  }
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});
test("Collect by URL exige contrato e reserva própria; nunca ocorre no discovery", async () => {
  const calls: { url: URL; body: unknown }[] = [];
  let reservations = 0;
  const transport: typeof fetch = async (url, init) => {
    if (init?.method === "POST")
      calls.push({
        url: new URL(String(url)),
        body: JSON.parse(String(init.body)),
      });
    return Response.json(
      init?.method === "POST" ? [nativeListing] : nativeMetadata(),
    );
  };
  const disabled = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    transport,
  );
  await assert.rejects(
    disabled.getListing(nativeListing.url),
    /Enriquecimento desativado/,
  );
  assert.equal(calls.length, 0);
  const blocked = new BrightDataProvider(
    {
      apiKey: "fake",
      rightsConfirmed: "true",
      reserveCollectTrigger: async () => false,
    },
    transport,
  );
  await assert.rejects(blocked.getListing(nativeListing.url), /Limite diário/);
  assert.equal(calls.length, 0);
  const allowed = new BrightDataProvider(
    {
      apiKey: "fake",
      rightsConfirmed: "true",
      reserveCollectTrigger: async () => {
        reservations++;
        return true;
      },
    },
    transport,
  );
  for (const url of [
    searchUrl,
    "https://127.0.0.1/marketplace/item/112233/",
    "https://facebook.com/marketplace/item/112233/?redirect_url=https://evil.com",
  ])
    await assert.rejects(allowed.getListing(url), /URL/);
  assert.equal(reservations, 0);
  assert.equal(
    (await allowed.getListing(nativeListing.url))?.availability,
    "unknown",
  );
  assert.equal(reservations, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/datasets/v3/scrape");
  assert.equal(calls[0].url.searchParams.has("discover_by"), false);
  assert.deepEqual(calls[0].body, {
    input: [{ url: nativeListing.url }],
    limit_per_input: 1,
  });
});
test("preflight de filtro inválido não reserva budget, não marca disparo incerto e permite correção", async () => {
  const { db, createUser } = database();
  await createUser();
  await enqueueTest(db, "u1", providerQuery("iPhone 15"), 5, config);
  const { provider, calls } = harness();
  assert.equal((await runOne(db, "u1", () => provider, config)).status, "dead");
  assert.equal((await diagnostics(db, "u1", config)).usedToday, 0);
  assert.equal(
    calls.some((c) => c.method === "POST"),
    false,
  );
  assert.equal(
    (await enqueueTest(db, "u1", providerQuery("iPhone 15"), 5, config)).queued,
    1,
  );
});
test("snapshot por execução conserva filtros/limite e localização retornada separada", async () => {
  const { db, createUser } = database();
  await createUser();
  const filters = {
    city: "Curitiba",
    radius: 40,
    date_listed: "Last 24 hours",
  };
  const q = providerQuery("iPhone 15", "keyword", null, filters);
  await enqueueTest(db, "u1", q, 5, config);
  const { provider, calls } = harness();
  assert.equal(
    (await runOne(db, "u1", () => provider, config)).status,
    "waiting",
  );
  await db
    .prepare("UPDATE jobs SET available_at='2000-01-01' WHERE status='pending'")
    .run();
  assert.equal((await runOne(db, "u1", () => provider, config)).status, "done");
  const d = await diagnostics(db, "u1", config);
  const snapshot = JSON.parse(String(d.runs[0].request_snapshot));
  assert.deepEqual(snapshot.input, { keyword: "iPhone 15", ...filters });
  assert.equal(snapshot.dataset, dataset);
  assert.equal(snapshot.limit, 5);
  assert.equal(snapshot.contract, "discover_by_keyword");
  assert.equal(d.usedToday, 1);
  assert.equal((await getMonitors(db, "u1")).length, 0);
  const listings = await getListings(db, "u1");
  assert.equal(listings[0].returnedLocation, nativeListing.location);
  assert.equal(listings[0].city, "Pinhais");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});
test("filtros persistem em monitor; ordem das chaves/metadata não contorna dedup", async () => {
  const { db, createUser } = database();
  await createUser();
  const m = await saveMonitor(db, "u1", {
    name: "Curitiba",
    provider: "brightdata",
    query: "iPhone 15",
    providerFilters: { city: "Curitiba", radius: 40 },
  });
  assert.deepEqual((await getMonitors(db, "u1"))[0].providerFilters, {
    city: "Curitiba",
    radius: 40,
  });
  const { id, revision, ...saved } = m;
  const edited = await saveMonitor(
    db,
    "u1",
    { ...saved, providerFilters: { city: "Pinhais" } },
    id,
  );
  assert.equal(edited.revision, revision + 1);
  assert.equal(
    (
      await enqueueTest(
        db,
        "u1",
        {
          type: "keyword",
          keyword: "iPhone 15",
          filters: { city: "Curitiba", radius: 40 },
        },
        5,
        config,
      )
    ).queued,
    1,
  );
  assert.equal(
    (
      await enqueueTest(
        db,
        "u1",
        {
          type: "keyword",
          keyword: "iPhone 15",
          filters: { radius: 40, city: "Curitiba" },
          contractFingerprint: "a".repeat(64),
        },
        5,
        config,
      )
    ).queued,
    0,
  );
});
test("filtros não sobrescrevem parâmetros privilegiados e anúncio sem localização não a inventa", () => {
  for (const key of [
    "keyword",
    "url",
    "dataset_id",
    "type",
    "discover_by",
    "limit_per_input",
    "api_key",
    "token",
    "constructor",
    "__proto__",
  ])
    assert.equal(
      providerFiltersSchema.safeParse(JSON.parse(`{"${key}":"x"}`)).success,
      false,
    );
  assert.equal(
    mapFacebook({ ...nativeListing, location: null })?.returnedLocation,
    null,
  );
  assert.equal(mapFacebook({ ...nativeListing, location: null })?.city, "");
});
