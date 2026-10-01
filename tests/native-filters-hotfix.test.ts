import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  nativePublicationPolicy,
  nativeRadius,
  exactNativeFilters,
  publicationDays,
} from "../providers/search-policy";
import {
  inspectBrightDataMetadata,
  discoveryInput,
} from "../providers/brightdata-schema";
import {
  confirmedHealth,
  confirmedSchema,
  type InputConfirmation,
} from "../providers/input-confirmation";
import {
  readInputConfirmation,
  type InputConfirmationView,
} from "../server/input-confirmation";
import { nativeMetadata } from "./brightdata-fixtures";
import { database } from "./fixtures";
import { createHandler } from "../server/http";
import { BrightDataProvider } from "../providers/brightdata";
import { getMonitors } from "../server/store";
import type { ProviderQuery } from "../core/provider-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchWizard } from "../components/saas/search-wizard";
import { bootstrap } from "../server/bootstrap";
import { ensureUser } from "../server/seed";

const dataset = "gd_lvt9iwuh6fbcwmx1a";
const originalMetadata = () =>
  JSON.parse(
    readFileSync("tests/fixtures/brightdata-metadata-2026-09-12.json", "utf8"),
  );
const query: ProviderQuery = {
  type: "keyword",
  keyword: "iphone 13",
  filters: { city: "Curitiba", radius: 10, date_listed: "Last 24 hours" },
};
const completeSchema = async () =>
  (await inspectBrightDataMetadata(nativeMetadata(), dataset)).schemas!
    .keyword!;

test("Filtros: 7 dias/30 km substituem filtros legados 24h/10; payload exato e entrada imutável", async () => {
  const schema = await completeSchema();
  const before = structuredClone(query);
  const prepared = exactNativeFilters(
    { ...query, contractFingerprint: schema.fingerprint },
    schema,
    10080,
    30,
  );
  assert.deepEqual(discoveryInput(schema, prepared.query), {
    keyword: "iphone 13",
    city: "Curitiba",
    radius: 30,
    date_listed: "Last 7 days",
  });
  assert.deepEqual(query, before);
  assert.equal(prepared.query.contractFingerprint, schema.fingerprint);
  assert.equal(prepared.coverage, "native");
});
test("Filtros: volta de 7 dias/30 para 24h/15 é respeitada sem guardar escolhas antigas", async () => {
  const schema = await completeSchema();
  const a = exactNativeFilters(query, schema, 10080, 30);
  const b = exactNativeFilters(a.query, schema, 1440, 15);
  assert.equal(b.query.filters!.date_listed, "Last 24 hours");
  assert.equal(b.query.filters!.radius, 15);
});
test("Filtros: metadata observada incompleta não é preenchida com enum ou km inventados", async () => {
  const raw = await inspectBrightDataMetadata(originalMetadata(), dataset);
  const schema = raw.schemas!.keyword!;
  assert.equal(schema.fields.find((f) => f.name === "radius")!.unit, undefined);
  const plan = nativePublicationPolicy(query, schema, 10080);
  assert.equal(plan.days, null);
  assert.match(plan.issue!, /7 dias/);
  assert.throws(() => exactNativeFilters(query, schema, 10080, 30), {
    code: "native_filters_unconfirmed",
    phase: "preflight",
    retryable: false,
  });
  assert.throws(() => nativeRadius(query, schema, 30), /unidade do raio/);
});
test("Filtros: confirmação de painel suplementa somente campos existentes, sem alterar fingerprint da metadata", async () => {
  const health = await inspectBrightDataMetadata(originalMetadata(), dataset);
  const base = structuredClone(health);
  const c: InputConfirmation = {
    id: "local-test",
    dataset,
    baseFingerprint: health.schemas!.keyword!.fingerprint,
    oneDayValue: "Last 24 hours",
    sevenDayValue: "Last 7 days",
    radiusUnit: "km",
    confirmedAt: new Date().toISOString(),
  };
  const ready = confirmedHealth(health, dataset, c).schemas!.keyword!;
  const plan = exactNativeFilters(query, ready, 10080, 30);
  assert.deepEqual(discoveryInput(ready, plan.query), {
    keyword: "iphone 13",
    city: "Curitiba",
    radius: 30,
    date_listed: "Last 7 days",
  });
  assert.deepEqual(health, base);
  assert.equal(ready.fingerprint, health.schemas!.keyword!.fingerprint);
  assert.equal(plan.query.inputConfirmationId, "local-test");
  assert.equal(
    ready.fields.find((f) => f.name === "date_listed")!.optionsSource,
    "account_panel",
  );
  assert.equal(
    ready.fields.find((f) => f.name === "date_listed")!.enumPublished,
    false,
  );
});
test("Filtros: confirmação não atravessa dataset/fingerprint e enum remoto sempre prevalece", async () => {
  const base = await completeSchema();
  const c: InputConfirmation = {
    id: "c",
    dataset,
    baseFingerprint: base.fingerprint,
    sevenDayValue: "Invalid period",
    radiusUnit: "miles",
    confirmedAt: new Date().toISOString(),
  };
  const updated = confirmedSchema(base, dataset, c)!;
  assert.equal(updated.fields.find((f) => f.name === "radius")!.unit, "km");
  assert.ok(
    !updated.fields
      .find((f) => f.name === "date_listed")!
      .options!.includes("Invalid period"),
  );
  assert.equal(confirmedSchema(base, "gd_other", c), base);
  assert.equal(
    confirmedSchema(base, dataset, { ...c, baseFingerprint: "f".repeat(64) }),
    base,
  );
});
test("Filtros: conversão km/milhas/metros é explícita e não omite raio", async () => {
  const base = await completeSchema();
  for (const [unit, amount] of [
    ["km", 30],
    ["miles", Number((30 / 1.609344).toPrecision(15))],
    ["m", 30000],
  ] as const) {
    const schema = {
      ...base,
      fields: base.fields.map((f) =>
        f.name === "radius" ? { ...f, unit, max: 100000 } : f,
      ),
    };
    const planned = nativeRadius(query, schema, 30);
    assert.equal(planned.filters!.radius, amount);
    assert.deepEqual(discoveryInput(schema, planned).radius, amount);
  }
});
test("Filtros: raio textual segue tipo do contrato; inteiros, enum e limites não são contornados", async () => {
  const base = await completeSchema();
  const withRadius = (patch: Record<string, unknown>) => ({
    ...base,
    fields: base.fields.map((f) =>
      f.name === "radius" ? { ...f, ...patch } : f,
    ),
  });
  assert.equal(
    nativeRadius(query, withRadius({ type: "text" }), 30).filters!.radius,
    "30",
  );
  assert.throws(
    () =>
      nativeRadius(query, withRadius({ type: "integer", unit: "miles" }), 30),
    /exatamente/,
  );
  assert.throws(
    () => nativeRadius(query, withRadius({ options: [10, 20] }), 30),
    /permitidos/,
  );
  assert.throws(() => nativeRadius(query, base, 101), /limites/);
  for (const value of [0, -1, NaN, Infinity])
    assert.throws(() => nativeRadius(query, base, value), /raio/);
});
test("Filtros: labels são reconhecidos por inteiro, sem confundir números não documentados", () => {
  assert.equal(publicationDays("Last 7 days"), 7);
  assert.equal(publicationDays("LAST_24_HOURS"), 1);
  assert.equal(publicationDays("Últimos 7 dias"), 7);
  assert.equal(publicationDays("not Last 7 days"), null);
  assert.equal(publicationDays(7), null);
  assert.equal(publicationDays("Last 70 days"), null);
});
test("Filtros: modo URL preserva consulta existente em vez de injetar campos keyword", async () => {
  const q: ProviderQuery = {
    type: "search_url",
    url: "https://www.facebook.com/marketplace/curitiba/search/?query=iphone&daysSinceListed=7&radius=30",
  };
  assert.deepEqual(exactNativeFilters(q, undefined, 10080, 30).query, q);
});

const config = {
  AUTH_MODE: "local-development",
  ALLOW_LOCAL_DEV_AUTH: "true",
  RADAR_ADMIN_IDS: "local-radar",
  COLLECTION_ENABLED: "true",
  PILOT_MODE: "true",
  BRIGHTDATA_API_KEY: "synthetic-local-only",
  FACEBOOK_DATA_RIGHTS_CONFIRMED: "true",
  BRIGHTDATA_DATASET_ID: dataset,
  WORKER_TOKEN: "synthetic-worker-".repeat(4),
};
function req(path: string, body?: unknown) {
  return new Request("http://localhost:5173/api/v1/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: "http://localhost:5173",
      "content-type": "application/json",
      ...(path === "worker/tick"
        ? { authorization: "Bearer " + config.WORKER_TOKEN }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function harness() {
  const d = database();
  const calls: { path: string; body: unknown; method: string }[] = [];
  let metadata = originalMetadata();
  const transport = (async (u, init) => {
    const url = new URL(String(u));
    const method = init?.method ?? "GET";
    calls.push({
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      method,
    });
    if (url.pathname.endsWith("/scrapers")) return Response.json(metadata);
    if (url.pathname.endsWith("/trigger"))
      return Response.json({ snapshot_id: "sd_native_filter_test" });
    if (url.pathname.includes("/progress/"))
      return Response.json({
        status: "ready",
        snapshot_id: "sd_native_filter_test",
        dataset_id: dataset,
      });
    if (url.pathname.includes("/snapshot/")) return Response.json([]);
    throw new Error("Unexpected test route");
  }) as typeof fetch;
  const factory = () =>
    new BrightDataProvider(
      {
        apiKey: config.BRIGHTDATA_API_KEY,
        rightsConfirmed: "true",
        dataset,
        inputConfirmation: () => readInputConfirmation(d.db, dataset),
      },
      transport,
    );
  const handler = createHandler(d.db, config, {
    development: true,
    provider: factory,
  });
  return {
    ...d,
    calls,
    factory,
    handler,
    setMetadata(v: unknown) {
      metadata = v;
    },
  };
}
async function confirm(h: ReturnType<typeof harness>) {
  const health = await h.factory().healthCheck();
  const response = await h.handler(
    req("admin/provider/filters", {
      dataset,
      baseFingerprint: health.schemas!.keyword!.fingerprint,
      oneDayValue: "Last 24 hours",
      sevenDayValue: "Last 7 days",
      radiusUnit: "km",
      confirmed: true,
    }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<InputConfirmationView>;
}
async function save(h: ReturnType<typeof harness>, extras = {}) {
  const r = await h.handler(
    req("searches", {
      requestKey: crypto.randomUUID(),
      config: {
        name: "iPhone 13",
        product: "iPhone 13",
        query: "iPhone 13",
        city: "Curitiba",
        intent: "personal",
        maxPrice: 2200,
        radiusKm: 30,
        maxListingAgeMinutes: 10080,
        intervalSeconds: 300,
        ...extras,
      },
    }),
  );
  assert.equal(r.status, 201, await r.clone().text());
  return (await getMonitors(h.db, "local-radar"))[0];
}

test("Filtros HTTP: confirmar valores é administrativo, não dispara coleta nem altera cotas", async () => {
  const h = harness();
  try {
    const out = await confirm(h);
    assert.deepEqual(out.example.input, {
      keyword: "iphone 13",
      city: "Curitiba",
      date_listed: "Last 7 days",
      radius: 30,
    });
    assert.equal(out.example.paidRequest, false);
    assert.equal(h.calls.filter((c) => c.method === "POST").length, 0);
    assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM jobs").get()!.n, 0);
    assert.equal(
      h.sql
        .prepare("SELECT COUNT(*) n FROM rate_limits WHERE key LIKE 'budget:%'")
        .get()!.n,
      0,
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT COUNT(*) n FROM audit_events WHERE action='native_input_confirmation_saved'",
        )
        .get()!.n,
      1,
    );
    const ordinary = createHandler(
      h.db,
      { ...config, RADAR_ADMIN_IDS: "" },
      { development: true, provider: h.factory },
    );
    assert.equal((await ordinary(req("admin/provider/filters"))).status, 403);
    assert.equal(
      (await ordinary(req("admin/provider/filters", {}))).status,
      403,
    );
  } finally {
    h.sql.close();
  }
});
test("Filtros HTTP: não permite ampliar enum remoto, contradizer unidade, confundir 24h/7d ou salvar confirmação obsoleta", async () => {
  const h = harness();
  try {
    h.setMetadata(nativeMetadata());
    const health = await h.factory().healthCheck();
    const body = {
      dataset,
      baseFingerprint: health.schemas!.keyword!.fingerprint,
      sevenDayValue: "Last 7 days",
      radiusUnit: "km",
      confirmed: true,
    };
    for (const patch of [
      { sevenDayValue: "Last 90 days" },
      { radiusUnit: "miles" },
      { sevenDayValue: "Last 24 hours" },
    ]) {
      assert.equal(
        (await h.handler(req("admin/provider/filters", { ...body, ...patch })))
          .status,
        422,
      );
    }
    assert.equal(
      (
        await h.handler(
          req("admin/provider/filters", {
            ...body,
            baseFingerprint: "a".repeat(64),
          }),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await h.handler(
          req("admin/provider/filters", { ...body, confirmed: false }),
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await h.handler(
          req("admin/provider/filters", { ...body, dataset: "gd_other" }),
        )
      ).status,
      409,
    );
    assert.equal(await readInputConfirmation(h.db, dataset), null);
  } finally {
    h.sql.close();
  }
});
test("Filtros integração: consulta incompleta para antes da cota; após confirmação envia 7 dias/30, sem recriar monitor", async () => {
  const h = harness();
  try {
    const m = await save(h, {
      providerFilters: { date_listed: "Last 24 hours", radius: 10 },
    });
    await h.handler(req("admin/provider/check", {}));
    await h.handler(req("scan", { monitorId: m.id, confirmConsumption: true }));
    await h.handler(req("worker/tick", {}));
    assert.equal(h.calls.filter((c) => c.path.endsWith("/trigger")).length, 0);
    assert.equal(
      h.sql
        .prepare("SELECT COUNT(*) n FROM rate_limits WHERE key LIKE 'budget:%'")
        .get()!.n,
      0,
    );
    assert.match(
      String(h.sql.prepare("SELECT errors FROM provider_runs").get()!.errors),
      /native_filters_unconfirmed/,
    );
    const before = await getMonitors(h.db, "local-radar");
    await confirm(h);
    assert.deepEqual(await getMonitors(h.db, "local-radar"), before);
    const after = createHandler(h.db, config, {
      development: true,
      provider: h.factory,
    });
    await after(req("scan", { monitorId: m.id, confirmConsumption: true }));
    await after(req("worker/tick", {}));
    const triggers = h.calls.filter((c) => c.path.endsWith("/trigger"));
    assert.equal(triggers.length, 1);
    assert.deepEqual(triggers[0].body, [
      {
        keyword: "iphone 13",
        city: "Curitiba",
        radius: 30,
        date_listed: "Last 7 days",
      },
    ]);
    const run = h.sql
      .prepare(
        "SELECT request_snapshot FROM provider_runs WHERE status='waiting'",
      )
      .get()!;
    const snapshot = JSON.parse(String(run.request_snapshot));
    assert.equal(snapshot.publicationFilter.days, 7);
    assert.equal(snapshot.radiusFilter.requestedKm, 30);
    assert.equal(snapshot.radiusFilter.sentUnit, "km");
    assert.ok(snapshot.inputConfirmationId);
    assert.equal(
      h.sql.prepare("SELECT COUNT(*) n FROM provider_runs").get()!.n,
      2,
    );
    // Already-paid snapshot is immutable; changing profile cannot create a new POST.
    h.sql.exec(
      "DELETE FROM provider_health WHERE kind='input_confirmation'; UPDATE jobs SET available_at='2000-01-01' WHERE status='pending'",
    );
    await after(req("worker/tick", {}));
    assert.equal(h.calls.filter((c) => c.path.endsWith("/trigger")).length, 1);
    assert.equal(
      h.sql.prepare("SELECT COUNT(*) n FROM jobs WHERE status='done'").get()!.n,
      1,
    );
  } finally {
    h.sql.close();
  }
});
test("Filtros: mudar metadata invalida complemento antigo e nenhum trigger é permitido", async () => {
  const h = harness();
  try {
    await confirm(h);
    const changed = originalMetadata();
    changed[0].scrapers.discover_by_keyword.input_schema.find(
      (f: { name: string }) => f.name === "radius",
    ).maximum = 100;
    h.setMetadata(changed);
    const health = await h.factory().healthCheck();
    const old = await readInputConfirmation(h.db, dataset);
    assert.equal(
      confirmedHealth(health, dataset, old).schemas!.keyword!.fields.find(
        (f) => f.name === "radius",
      )!.unit,
      undefined,
    );
    const view = (await (
      await h.handler(req("admin/provider/filters"))
    ).json()) as InputConfirmationView;
    assert.equal(view.stale, true);
    assert.equal(view.example.input, null);
    assert.equal(h.calls.filter((c) => c.method === "POST").length, 0);
  } finally {
    h.sql.close();
  }
});
test("Filtros: confirmação alterada entre planejar e preparar bloqueia envio incoerente", async () => {
  const h = harness();
  try {
    await confirm(h);
    const health = await h.factory().healthCheck();
    const ready = confirmedHealth(
      health,
      dataset,
      await readInputConfirmation(h.db, dataset),
    ).schemas!.keyword!;
    const planned = exactNativeFilters(query, ready, 10080, 30);
    await confirm(h); // New operator confirmation id, same upstream contract.
    await assert.rejects(h.factory().prepareQuery(planned.query), {
      phase: "preflight",
      code: "native_filters_unconfirmed",
    });
    assert.equal(h.calls.filter((c) => c.method === "POST").length, 0);
  } finally {
    h.sql.close();
  }
});
test("Filtros UI: assistente não promete trocar 7 dias por 24 e orienta confirmação antes de consumo", async () => {
  const h = harness();
  try {
    await ensureUser(h.db, "local-radar");
    await h.handler(req("admin/provider/check", {}));
    const b = await bootstrap(
      h.db,
      { kind: "user", userId: "local-radar", admin: true },
      config,
      true,
    );
    const html = renderToStaticMarkup(
      createElement(SearchWizard, {
        bootstrap: b,
        draft: {
          step: 3,
          values: {
            product: "iPhone 13",
            city: "Curitiba",
            radiusKm: 30,
            maxListingAgeMinutes: 10080,
            maxPrice: 2200,
          },
        },
        onClose() {},
        onSaved() {},
      }),
    );
    assert.match(html, /Filtros da busca/);
    assert.doesNotMatch(html, /Vamos usar esse período mais curto/);
    assert.equal(b.service.nativeRecency, "local_only");
    assert.equal(b.service.nativeRadiusConfirmed, false);
  } finally {
    h.sql.close();
  }
});

test("Filtros integração: edição parcial de 24h/10 para 7d/30 altera o próximo input sem zerar filtros ocultos", async () => {
  const h = harness();
  try {
    await confirm(h);
    const m = await save(h, {
      radiusKm: 10,
      maxListingAgeMinutes: 1440,
      providerFilters: { date_listed: "Last 24 hours", radius: 10 },
    });
    const updated = await h.handler(
      req("searches/" + m.id, {
        expectedVersion: m.version ?? 0,
        config: { radiusKm: 30, maxListingAgeMinutes: 10080 },
      }),
    );
    assert.equal(updated.status, 200, await updated.clone().text());
    const current = (await getMonitors(h.db, "local-radar"))[0];
    assert.equal(current.radiusKm, 30);
    assert.equal(current.maxListingAgeMinutes, 10080);
    assert.equal(
      current.providerFilters?.date_listed,
      "Last 24 hours",
      "Não apaga configurações salvas apenas para ajustar a requisição",
    );
    await h.handler(req("scan", { monitorId: m.id, confirmConsumption: true }));
    await h.handler(req("worker/tick", {}));
    assert.deepEqual(h.calls.find((c) => c.path.endsWith("/trigger"))!.body, [
      {
        keyword: "iphone 13",
        city: "Curitiba",
        radius: 30,
        date_listed: "Last 7 days",
      },
    ]);
  } finally {
    h.sql.close();
  }
});
