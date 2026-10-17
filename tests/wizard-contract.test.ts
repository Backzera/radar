import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { database, monitor } from "./fixtures";
import { ensureUser } from "../server/seed";
import { bootstrap } from "../server/bootstrap";
import {
  SearchWizard,
  initialSearchValues,
} from "../components/saas/search-wizard";
test("Assistente: contrato inicial preserva campos ocultos e renderiza entrada de revenda sem telemetria técnica", async () => {
  const { db, sql } = database();
  await ensureUser(db, "u1");
  const b = await bootstrap(
    db,
    { kind: "user", userId: "u1", admin: false },
    { COLLECTION_ENABLED: "false" },
  );
  const original = {
    ...monitor,
    latitude: -25.2,
    longitude: -49.2,
    minPrice: 199.99,
    manualPrice: 3000,
    minLiquidity: 10,
    intent: "resale" as const,
    negativeMode: "literal" as const,
  };
  assert.deepEqual(initialSearchValues(original, b), original);
  const personal = initialSearchValues(undefined, b);
  assert.equal(personal.intent, "resale");
  assert.equal(personal.negativeMode, "contextual");
  const html = renderToStaticMarkup(
    createElement(SearchWizard, { bootstrap: b, onClose() {}, onSaved() {} }),
  );
  assert.match(html, /Comprar para mim/);
  assert.match(html, /Comprar para revender/);
  assert.doesNotMatch(
    html,
    /BRIGHTDATA_API_KEY|WORKER_TOKEN|providerContractFingerprint/,
  );
  sql.close();
});

test("2.0 assistente: etapas renderizam orçamento e ativação sem campo de aliases ou fórmulas", async () => {
  const { db, sql } = database();
  await ensureUser(db, "u1");
  try {
    const b = await bootstrap(
      db,
      { kind: "user", userId: "u1", admin: false },
      { COLLECTION_ENABLED: "false" },
    );
    for (const step of [0, 1, 2]) {
      const html = renderToStaticMarkup(
        createElement(SearchWizard, {
          bootstrap: b,
          draft: {
            step,
            requestKey: crypto.randomUUID(),
            values: {
              ...initialSearchValues(undefined, b),
              product: "iPhone 14",
              city: "Curitiba",
              maxPrice: 2200,
            },
          },
          onClose() {},
          onSaved() {},
        }),
      );
      // Sem termos técnicos nem opções avançadas no fluxo simples do cliente.
      assert.doesNotMatch(
        html,
        /nomes alternativos.*v[ií]rgula|P25|baseline|Opportunity Score|op[çc][õo]es avan[çc]adas|Intervalo solicitado|Pontua[çc][ãa]o m[íi]nima/i,
      );
      if (step === 2) assert.match(html, /Ativar radar e avisar/);
    }
  } finally {
    sql.close();
  }
});
