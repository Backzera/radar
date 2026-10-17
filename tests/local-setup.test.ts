import test from "node:test";
import assert from "node:assert/strict";
import { providerSetup } from "../server/provider-setup";
import { providerQuery, ProviderQueryError } from "../core/provider-query";
import { monitorSchema } from "../server/validation";

test("setup reflete o scraper próprio (SCRAPER_URL) sem serializar secrets", () => {
  // Sem SCRAPER_URL, a fonte não está pronta.
  const off = providerSetup(
    { WORKER_TOKEN: "fixture-worker-value", BRIGHTDATA_API_KEY: "fixture-private-value" },
    true,
  );
  assert.equal(off.ready, false);
  assert.equal(off.scraperConfigured, false);
  // Com o microserviço configurado, a fonte fica pronta.
  const on = providerSetup(
    { WORKER_TOKEN: "fixture-worker-value", SCRAPER_URL: "http://localhost:8000" },
    true,
  );
  assert.equal(on.ready, true);
  assert.equal(on.scraperConfigured, true);
  assert.ok(!JSON.stringify(on).includes("fixture-"));
});
test("listing URL e keyword vazia retornam erro de entrada útil", () => {
  assert.throws(
    () =>
      providerQuery(
        "",
        "search_url",
        "https://www.facebook.com/marketplace/item/123/",
      ),
    (e: unknown) =>
      e instanceof ProviderQueryError && /link de um anúncio/.test(e.message),
  );
  assert.throws(() => providerQuery(" "), ProviderQueryError);
  assert.throws(
    () =>
      providerQuery("", "search_url", "https://localhost/marketplace/search/"),
    ProviderQueryError,
  );
  const result = monitorSchema.safeParse({
    name: "iPhone 15",
    provider: "brightdata",
    queryType: "search_url",
    searchUrl: "https://facebook.com/marketplace/item/123/",
  });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.message, /link de um anúncio/);
});
