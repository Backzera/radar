import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderSetupChecklist } from "../components/provider-setup";
import { providerSetup } from "../server/provider-setup";
import { providerQuery, ProviderQueryError } from "../core/provider-query";
import { monitorSchema } from "../server/validation";

test("setup separa chave/dataset/direitos sem serializar secrets", () => {
  const setup = providerSetup(
    {
      BRIGHTDATA_API_KEY: "fixture-private-value",
      WORKER_TOKEN: "fixture-worker-value",
      BRIGHTDATA_DATASET_ID: "gd_lvt9iwuh6fbcwmx1a",
      FACEBOOK_DATA_RIGHTS_CONFIRMED: "false",
    },
    true,
  );
  assert.equal(setup.apiKeyConfigured, true);
  assert.equal(setup.rightsConfirmed, false);
  assert.equal(setup.ready, false);
  assert.ok(!JSON.stringify(setup).includes("fixture-"));
  const html = renderToStaticMarkup(
    createElement(ProviderSetupChecklist, {
      setup,
      validated: true,
      collectionVerified: false,
      hasMonitor: false,
    }),
  );
  assert.match(html, /Confirmação de uso/);
  assert.match(html, /Pendente/);
  assert.match(html, /Aguardando validação/);
  assert.ok(!html.includes("fixture-"));
});
test("guia de chave ausente e checklist não afirmam coleta real", () => {
  const html = renderToStaticMarkup(
    createElement(ProviderSetupChecklist, {
      setup: providerSetup({}, true),
      validated: false,
      collectionVerified: false,
      hasMonitor: false,
    }),
  );
  assert.match(html, /BRIGHTDATA_API_KEY/);
  assert.match(html, /\.dev\.vars/);
  assert.match(html, /reinicie o servidor/);
  assert.ok(!html.includes("✓ Concluído"));
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
