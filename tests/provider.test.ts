import test from "node:test";
import assert from "node:assert/strict";
import {
  BrightDataProvider,
  mapFacebook,
  facebookUrl,
} from "../providers/brightdata";
import { now } from "./fixtures";
const request = {
  query: "iphone 15",
  city: "Curitiba",
  radiusKm: 30,
  sequence: 0,
  limit: 25,
};
const input = {
  product_id: "123",
  url: "https://www.facebook.com/marketplace/item/123/",
  title: "iPhone 15 128 GB",
  description: "usado",
  final_price: 2200,
  currency: "BRL",
  listing_date: "2026-09-10T14:56:00Z",
  country_code: "BR",
};
const metadata = [
  {
    id: "gd_lvt9iwuh6fbcwmx1a",
    domain: "facebook.com",
    scrapers: {
      discover_by_keyword: {
        input_schema: [{ name: "keyword", type: "text", required: true }],
        output_fields: [
          "product_id",
          "url",
          "title",
          "final_price",
          "currency",
        ].map((name) => ({ name })),
      },
    },
  },
];
test("guard sem credenciais/direitos faz zero chamadas", async () => {
  let count = 0;
  const p = new BrightDataProvider({}, async () => {
    count++;
    return Response.json({});
  });
  await assert.rejects(p.search(request));
  assert.equal(count, 0);
});
test("adapter confirma schema, persiste snapshot e acompanha estados sem novo POST", async () => {
  const calls: string[] = [];
  const responses = [
    Response.json(metadata),
    Response.json({ snapshot_id: "s_123" }),
    Response.json({ status: "running" }),
    Response.json({ status: "ready" }),
    Response.json([input]),
  ];
  const p = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    async (url) => {
      calls.push(String(url));
      return responses.shift()!;
    },
  );
  const first = await p.search(request);
  assert.equal(first.complete, false);
  assert.equal(first.cursor, "s_123");
  const waiting = await p.search({ ...request, cursor: first.cursor });
  assert.equal(waiting.complete, false);
  const ready = await p.search({ ...request, cursor: first.cursor });
  assert.equal(ready.items.length, 1);
  assert.equal(ready.items[0].availability, "unknown");
  assert.equal(calls.filter((u) => u.includes("trigger?")).length, 1);
});
test("availability não deriva do status do job, data precisa timezone e preço não usa initial_price", () => {
  assert.equal(mapFacebook(input, now)?.availability, "unknown");
  assert.equal(
    mapFacebook({ ...input, listing_date: "2026-09-10" }, now)?.publishedAt,
    null,
  );
  assert.equal(
    mapFacebook({ ...input, listing_date: "2027-01-01T00:00:00Z" }, now)
      ?.publishedAt,
    null,
  );
  assert.equal(
    mapFacebook(
      { ...input, listing_date: null, creation_time: "2026-09-10T14:56:00Z" },
      now,
    )?.publishedAt,
    null,
  );
  assert.equal(
    mapFacebook({ ...input, final_price: undefined, initial_price: 2200 }, now)
      ?.price,
    null,
  );
});
test("contrato rejeita identidade/país divergentes e aceita preço textual brasileiro", () => {
  assert.equal(
    facebookUrl("https://facebook.com.evil.example/marketplace/"),
    false,
  );
  assert.equal(mapFacebook({ ...input, product_id: "999" }, now), null);
  assert.equal(mapFacebook({ ...input, country_code: "US" }, now), null);
  assert.equal(
    mapFacebook({ ...input, final_price: "R$ 2.200" }, now)?.price,
    2200,
  );
});
test("429 GET preserva Retry-After, 401 é permanente", async () => {
  const p = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    async () =>
      new Response("", { status: 429, headers: { "Retry-After": "90" } }),
  );
  await assert.rejects(
    p.search({ ...request, cursor: "s_123" }),
    (e: unknown) => (e as { retryAfter: number }).retryAfter === 90,
  );
  const denied = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    async () => new Response("", { status: 401 }),
  );
  await assert.rejects(
    denied.search(request),
    (e: unknown) => (e as { retryable: boolean }).retryable === false,
  );
});
test("timeout de trigger não é reenviado cegamente", async () => {
  let n = 0;
  const p = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    async () => {
      if (!n++) return Response.json(metadata);
      throw new Error("timeout");
    },
  );
  await assert.rejects(
    p.search(request),
    (e: unknown) => (e as { retryable: boolean }).retryable === false,
  );
});
test("health check rejeita método vazio e campo obrigatório inesperado", async () => {
  const bad = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    async () =>
      Response.json([
        {
          id: "gd_lvt9iwuh6fbcwmx1a",
          domain: "facebook.com",
          scrapers: { discover_by_keyword: {} },
        },
      ]),
  );
  assert.equal((await bad.healthCheck()).ok, false);
  const changed = structuredClone(metadata);
  changed[0].scrapers.discover_by_keyword.input_schema.push({
    name: "new_required_field",
    type: "text",
    required: true,
  });
  const p = new BrightDataProvider(
    { apiKey: "fake", rightsConfirmed: "true" },
    async () => Response.json(changed),
  );
  assert.equal((await p.healthCheck()).ok, false);
});
test("detalhe Facebook usa URL validada e não fabrica disponibilidade", async () => {
  const p = new BrightDataProvider(
    {
      apiKey: "fake",
      rightsConfirmed: "true",
      reserveCollectTrigger: async () => true,
    },
    async (_, init) =>
      Response.json(
        init?.method === "POST"
          ? [input]
          : [
              {
                ...metadata[0],
                scrapers: {
                  collect_by_url: {
                    input_schema: [
                      { name: "url", type: "url", required: true },
                    ],
                    output_fields:
                      metadata[0].scrapers.discover_by_keyword.output_fields,
                  },
                },
              },
            ],
      ),
  );
  const l = await p.getListing(input.url);
  assert.equal(l?.externalId, "123");
  assert.equal(l?.availability, "unknown");
  await assert.rejects(
    p.getListing("https://example.com/marketplace/item/123/"),
  );
});
