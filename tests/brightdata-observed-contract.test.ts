import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectBrightDataMetadata } from "../providers/brightdata-schema";
import {
  BrightDataProvider,
  mapFacebook,
  mapFacebookCandidate,
} from "../providers/brightdata";
import { database, monitor, now } from "./fixtures";
import { enqueueTest, runOne } from "../server/worker";
import { diagnostics } from "../server/diagnostics";
import { saveCandidates } from "../server/discovery-candidates";
import { ingest } from "../server/ingestion";
import { getListings, getAlerts, all } from "../server/store";
import { DEFAULT_SETTINGS } from "../core/types";
import { nativeListing } from "./brightdata-fixtures";

test("URL de anúncio já completo não reabre pendência em outro escopo", async () => {
  const { db, createUser } = database();
  await createUser();
  const raw = mapFacebook(nativeListing, now)!;
  await ingest(
    db,
    "u1",
    { ...monitor, provider: "brightdata" },
    [raw],
    true,
    DEFAULT_SETTINGS,
    now,
  );
  const c = mapFacebookCandidate({ url: nativeListing.url })!;
  await saveCandidates(
    db,
    "u1",
    "other-scope",
    "other-run",
    [c],
    true,
    new Date(+now + 1000),
  );
  assert.equal((await diagnostics(db, "u1", config)).candidates.length, 0);
  assert.ok(
    (
      await db
        .prepare("SELECT resolved_at FROM discovery_candidates")
        .first<{ resolved_at: string }>()
    )?.resolved_at,
  );
});

// Only schema/links observed in an authenticated GET; no account credentials or listing samples.
function metadata(): {
  id: string;
  domain: string;
  scraper_type: string[];
  scrapers: Record<
    string,
    {
      input_schema: Record<string, unknown>[];
      output_fields: { name: string; type?: string }[];
      link: string;
    }
  >;
}[] {
  return JSON.parse(
    readFileSync("tests/fixtures/brightdata-metadata-2026-09-12.json", "utf8"),
  );
}
const dataset = "gd_lvt9iwuh6fbcwmx1a";
const config = {
  pilot: true,
  maxDailyTriggers: 5,
  maxRecords: 10,
  externalAlerts: false,
};
const query = {
  type: "keyword" as const,
  keyword: "iPhone 15",
  filters: { city: "Curitiba", radius: 40 },
};
test("metadata REAL observada confirma os três métodos sem exigir preço/título na fase discovery", async () => {
  const health = await inspectBrightDataMetadata(metadata(), dataset);
  assert.equal(health.ok, true);
  assert.deepEqual(health.methods, {
    keyword: true,
    search_url: true,
    collect_url: true,
  });
  assert.equal(health.schemas?.keyword?.discriminator, "keyword");
  assert.equal(health.schemas?.search_url?.discriminator, "url");
  assert.equal(health.schemas?.keyword?.outputKind, "url_candidates");
  assert.equal(health.schemas?.collect_url?.outputKind, "listing");
  assert.deepEqual(health.schemas?.keyword?.outputFields, [
    { name: "url", type: "url" },
  ]);
  const fields = health.schemas!.keyword!.fields;
  assert.equal(fields.find((f) => f.name === "city")?.required, true);
  assert.equal(fields.find((f) => f.name === "radius")?.type, "number");
  const date = fields.find((f) => f.name === "date_listed")!;
  assert.equal(date.supported, true);
  assert.equal(date.enumPublished, false);
  assert.equal(date.inputEnabled, true);
  assert.equal(date.optionsSource, "account_panel");
  assert.deepEqual(date.options, ["Last 24 hours"]);
  assert.equal(
    health.schemas?.search_url?.fields.find((f) => f.name === "country")
      ?.required,
    false,
  );
});
test("matching usa declaração, assinatura e link para ID opaco; ambiguidade/contradição bloqueia", async () => {
  const data = metadata();
  data[0].scrapers.internal_keyword_id = data[0].scrapers.discover_by_keyword;
  delete data[0].scrapers.discover_by_keyword;
  const h = await inspectBrightDataMetadata(data, dataset);
  assert.equal(h.methods?.keyword, true);
  assert.equal(h.schemas?.keyword?.endpointId, "internal_keyword_id");
  assert.equal(h.schemas?.keyword?.contract, "discover_by_keyword");
  assert.equal(h.schemas?.keyword?.discriminator, "keyword");
  data[0].scrapers.another_id = structuredClone(
    data[0].scrapers.internal_keyword_id,
  );
  assert.equal(
    (await inspectBrightDataMetadata(data, dataset)).methods?.keyword,
    false,
  );
  delete data[0].scrapers.another_id;
  data[0].scrapers.internal_keyword_id.link =
    "https://brightdata.com.evil.test/cp/scrapers/" +
    dataset +
    "/keyword/configuration";
  assert.equal(
    (await inspectBrightDataMetadata(data, dataset)).methods?.keyword,
    false,
  );
  const undeclared = metadata();
  undeclared[0].scraper_type = ["collect_by_url"];
  assert.equal(
    (await inspectBrightDataMetadata(undeclared, dataset)).methods?.keyword,
    false,
  );
});
test("schema de saída mínimo continua rejeitando URL incompatível e detalhe sem título", async () => {
  const data = metadata();
  data[0].scrapers.discover_by_keyword.output_fields = [
    { name: "url", type: "number" },
  ];
  assert.equal(
    (await inspectBrightDataMetadata(data, dataset)).methods?.keyword,
    false,
  );
  data[0].scrapers.collect_by_url.output_fields = [
    { name: "url", type: "url" },
  ];
  assert.equal(
    (await inspectBrightDataMetadata(data, dataset)).methods?.collect_url,
    false,
  );
  data[0].scrapers.collect_by_url.output_fields = [
    { name: "url", type: "url" },
    { name: "title", type: "text" },
    { name: "new_optional", type: "array" },
  ];
  assert.equal(
    (await inspectBrightDataMetadata(data, dataset)).methods?.collect_url,
    true,
  );
});
test("mínimo de listing é URL estável e título; id deriva da URL e preço permanece ausente", () => {
  const minimal = mapFacebook(
    { url: nativeListing.url, title: "iPhone 15" },
    now,
  )!;
  assert.equal(minimal.externalId, "112233");
  assert.equal(minimal.price, null);
  assert.equal(minimal.publishedAt, null);
  assert.equal(minimal.city, "");
  assert.deepEqual(minimal.images, []);
  assert.equal(mapFacebook({ url: nativeListing.url }), null);
  assert.equal(mapFacebook({ ...nativeListing, product_id: "999" }), null);
  assert.equal(
    mapFacebook({ ...nativeListing, error: "provider failed" }),
    null,
  );
  assert.equal(
    mapFacebook({ ...nativeListing, is_sold: true })?.availability,
    "sold",
  );
  assert.equal(
    mapFacebook({ ...nativeListing, is_sold: false })?.availability,
    "unknown",
  );
  assert.equal(
    mapFacebookCandidate({ url: nativeListing.url })?.externalId,
    "112233",
  );
  for (const extra of [
    { error: "failed" },
    { error_code: "404" },
    { product_id: "999" },
    { country_code: "US" },
    { title: 123 },
  ])
    assert.equal(
      mapFacebookCandidate({ url: nativeListing.url, ...extra }),
      null,
    );
});
test("snapshot rico funciona com metadata de discovery URL-only e não dispara collect extra", async () => {
  const posts: string[] = [];
  const p = new BrightDataProvider(
    { apiKey: "fixture-only", rightsConfirmed: "true" },
    async (url, init) => {
      const u = String(url);
      if (init?.method === "POST") posts.push(u);
      return Response.json(
        u.includes("scrapers?")
          ? metadata()
          : init?.method === "POST"
            ? { snapshot_id: "s_observed" }
            : u.includes("progress/")
              ? { status: "ready" }
              : [nativeListing],
      );
    },
  );
  const req = {
    query: "iPhone 15",
    providerQuery: query,
    city: "",
    radiusKm: 40,
    sequence: 0,
    limit: 5,
  };
  const pending = await p.search(req);
  const done = await p.search({ ...req, cursor: pending.cursor });
  assert.equal(done.items.length, 1);
  assert.equal(done.candidates?.length, 0);
  assert.equal(posts.length, 1);
  assert.match(posts[0], /discover_by=keyword/);
  await assert.rejects(
    p.prepareQuery({
      ...query,
      filters: { ...query.filters, date_listed: "Last 99 days" },
    }),
    /opções/,
  );
  assert.equal(posts.length, 1);
});
test("URL-only persiste como candidato, conclui baseline sem anúncios/alertas/coleta adicional", async () => {
  const { db, createUser } = database();
  await createUser();
  let posts = 0;
  const p = new BrightDataProvider(
    { apiKey: "fixture-only", rightsConfirmed: "true" },
    async (url, init) => {
      posts += Number(init?.method === "POST");
      const u = String(url);
      return Response.json(
        u.includes("scrapers?")
          ? metadata()
          : init?.method === "POST"
            ? { snapshot_id: "s_urls" }
            : u.includes("progress/")
              ? { status: "ready" }
              : [{ url: nativeListing.url }],
      );
    },
  );
  await enqueueTest(db, "u1", query, 5, config);
  assert.equal((await runOne(db, "u1", () => p, config)).status, "waiting");
  await db.prepare("UPDATE jobs SET available_at='2000-01-01'").run();
  const result = await runOne(db, "u1", () => p, config);
  assert.equal(result.status, "done");
  assert.ok("candidates" in result);
  assert.equal(result.candidates, 1);
  assert.equal(posts, 1);
  assert.equal((await getListings(db, "u1")).length, 0);
  assert.equal((await getAlerts(db, "u1")).length, 0);
  const d = await diagnostics(db, "u1", config);
  assert.equal(d.discoveryVerified, true);
  assert.equal(d.collectionVerified, false);
  assert.equal(d.candidates.length, 1);
  assert.equal(d.runs[0].status, "needs_details");
  assert.equal(d.usedToday, 1);
  assert.equal(
    (
      await db
        .prepare("SELECT baseline_complete FROM monitor_scopes")
        .first<{ baseline_complete: number }>()
    )?.baseline_complete,
    1,
  );
});
test("candidato repetido mantém primeiro visto; promoção preserva baseline e nunca alerta como novo", async () => {
  const { db, createUser } = database();
  await createUser();
  const m = {
    ...monitor,
    provider: "brightdata",
    city: "",
    mode: "manual" as const,
    manualPrice: 4000,
  };
  const scope = m.id + ":" + m.provider + ":" + m.revision,
    c = mapFacebookCandidate({ url: nativeListing.url })!;
  await saveCandidates(db, "u1", scope, "run1", [c], true, now);
  const later = new Date(+now + 60000);
  await saveCandidates(db, "u1", scope, "run2", [c], false, later);
  let candidates = await all<{
    first_seen_at: string;
    last_seen_at: string;
    baseline: number;
  }>(db, "SELECT * FROM discovery_candidates");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].first_seen_at, now.toISOString());
  assert.equal(candidates[0].last_seen_at, later.toISOString());
  assert.equal(candidates[0].baseline, 1);
  const raw = mapFacebook(nativeListing, later)!;
  assert.equal(
    (await ingest(db, "u1", m, [raw], false, DEFAULT_SETTINGS, later)).alerts,
    0,
  );
  const l = (await getListings(db, "u1"))[0];
  assert.equal(l.firstSeenAt, now.toISOString());
  assert.equal(l.baseline, true);
  assert.equal((await diagnostics(db, "u1", config)).candidates.length, 0);
  const newer = {
    ...c,
    externalId: "223344",
    url: "https://www.facebook.com/marketplace/item/223344/",
    originalUrl: "https://www.facebook.com/marketplace/item/223344/",
  };
  await saveCandidates(db, "u1", scope, "run3", [c, newer], false, later);
  candidates = await all(db, "SELECT * FROM discovery_candidates");
  assert.equal(candidates.length, 2);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT baseline FROM discovery_candidates WHERE external_id='223344'",
        )
        .first<{ baseline: number }>()
    )?.baseline,
    0,
  );
});
