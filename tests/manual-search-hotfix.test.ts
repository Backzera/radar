import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./fixtures";
import { createHandler } from "../server/http";
import { SelfScraperProvider } from "../providers/self-scraper";
import { getMonitors } from "../server/store";
import { bootstrap } from "../server/bootstrap";
import { ensureUser } from "../server/seed";

// "Buscar agora" com o scraper próprio (SelfScraperProvider). Diferente do fluxo
// Bright Data pago, search() é SÍNCRONO: um único worker/tick conclui a coleta
// (sem snapshot ready/building/failed nem ciclo de poll). Casos aposentados do
// arquivo original:
//  - snapshot "waiting"→"completed", "building" (HTTP 200) e período 7d/24h
//    nativo: o scraper devolve os itens de uma vez, não há snapshot a aguardar.
//  - preflight "Informe city" e "contrato mudou"/fingerprint: validações do
//    contrato pago da Bright Data; o scraper não tem schema/prepareQuery.
//  Em lugar deles, testamos a falha de coleta real do scraper e a ausência de
//  nova cobrança após a conclusão síncrona.

const cfg = {
  AUTH_MODE: "local-development",
  ALLOW_LOCAL_DEV_AUTH: "true",
  RADAR_ADMIN_IDS: "local-radar",
  COLLECTION_ENABLED: "true",
  PILOT_MODE: "true",
  SCRAPER_URL: "http://localhost:8000",
  WORKER_TOKEN: "test-worker-token-".repeat(4),
};
const request = (path: string, data?: unknown) =>
  new Request(`http://localhost:5173/api/v1/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      origin: "http://localhost:5173",
      "content-type": "application/json",
      ...(path === "worker/tick"
        ? { authorization: `Bearer ${cfg.WORKER_TOKEN}` }
        : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
function serviceItem(id: string, over: Record<string, unknown> = {}) {
  return {
    listingId: id,
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    title: "iPhone 14 128 GB usado",
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
  let items: unknown[] = [serviceItem("112233")];
  const transport = (async (input, init) => {
    const u = new URL(String(input));
    calls.push({
      path: u.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (u.pathname.endsWith("/search")) return Response.json({ items });
    throw new Error(`Rota inesperada do scraper: ${u.pathname}`);
  }) as typeof fetch;
  return {
    calls,
    transport,
    setItems: (v: unknown[]) => {
      items = v;
    },
  };
}
async function harness(
  overrides: Record<string, unknown> = {},
  transportOverride?: typeof fetch,
) {
  const f = database(),
    net = scraper();
  const transport = transportOverride ?? net.transport;
  const handler = createHandler(f.db, cfg, {
    development: true,
    provider: () =>
      new SelfScraperProvider(
        { baseUrl: cfg.SCRAPER_URL, maxRecords: 10 },
        transport,
      ),
  });
  // Ordem mostrada ao usuário: cria o monitor e depois habilita/valida a fonte.
  const saved = await handler(
    request("searches", {
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
        ...overrides,
      },
    }),
  );
  assert.equal(saved.status, 201, await saved.clone().text());
  const monitor = (await getMonitors(f.db, "local-radar"))[0];
  await handler(request("admin/provider/check", {}));
  const scan = () =>
    handler(request("scan", { monitorId: monitor.id, confirmConsumption: true }));
  const tick = () => handler(request("worker/tick", {}));
  return { ...f, net, handler, monitor, scan, tick };
}

test("hotfix: Buscar agora conclui de forma síncrona e o anúncio aparece no feed", async () => {
  const f = await harness();
  try {
    assert.equal((await f.scan()).status, 202);
    assert.equal((await f.tick()).status, 200);

    // Um único POST /search e conclusão imediata (sem estado "waiting").
    assert.equal(
      f.net.calls.filter((c) => c.path.endsWith("/search")).length,
      1,
    );
    assert.equal(f.net.calls[0].body!.city, "Curitiba");
    assert.match(String(f.net.calls[0].body!.query), /iphone/i);
    assert.equal(
      f.sql.prepare("SELECT status FROM provider_runs").get()!.status,
      "completed",
    );

    const feed = (await (
      await f.handler(request("results?filter=baseline&limit=25"))
    ).json()) as {
      total: number;
      items: { listing: { title: string; price: number; city: string } }[];
    };
    assert.equal(feed.total, 1);
    assert.match(feed.items[0].listing.title, /iPhone 14/);
    assert.equal(feed.items[0].listing.price, 2000);
    assert.equal(feed.items[0].listing.city, "Curitiba");
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM alerts").get()!.n, 0);

    // Depois de concluído, um novo tick não repete a coleta nem cobra de novo.
    f.sql.prepare("UPDATE jobs SET available_at='2000-01-01'").run();
    assert.equal((await f.tick()).status, 200);
    assert.equal(
      f.net.calls.filter((c) => c.path.endsWith("/search")).length,
      1,
    );
    assert.equal(
      f.sql.prepare("SELECT status FROM provider_runs").get()!.status,
      "completed",
    );
  } finally {
    f.sql.close();
  }
});

test("hotfix: nova solicitação não duplica coleta e a cota esgotada bloqueia o scan", async () => {
  const f = await harness();
  try {
    f.sql.prepare("UPDATE plans SET daily_triggers=1 WHERE id='managed'").run();
    assert.equal((await f.scan()).status, 202);
    const replay = await f.scan();
    const reply = (await replay.json()) as { queued: number; message: string };
    assert.equal(reply.queued, 0);
    assert.match(reply.message, /Nenhuma solicitação adicional/);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM jobs").get()!.n, 1);

    await f.tick();
    assert.equal(
      f.sql.prepare("SELECT status FROM provider_runs").get()!.status,
      "completed",
    );
    assert.equal(
      f.net.calls.filter((c) => c.path.endsWith("/search")).length,
      1,
    );

    const b = await bootstrap(
      f.db,
      { kind: "user", userId: "local-radar", admin: true },
      cfg,
      true,
    );
    assert.equal(b.service.quotaPaused, true);
    // Com a cota esgotada, uma nova solicitação é recusada (sem nova coleta).
    const blocked = await f.scan();
    assert.equal(blocked.status, 429);
    assert.equal(
      f.net.calls.filter((c) => c.path.endsWith("/search")).length,
      1,
    );
  } finally {
    f.sql.close();
  }
});

test("hotfix: só o anúncio novo dentro do orçamento e no prazo gera alerta", async () => {
  const f = await harness();
  try {
    // Primeira coleta conclui o baseline (não alerta).
    f.net.setItems([serviceItem("100")]);
    await f.scan();
    await f.tick();
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM alerts").get()!.n, 0);
    // Marca todas as palavras-chave como já exploradas para que a próxima coleta
    // seja incremental (não baseline), como num monitor em regime.
    f.sql.prepare("UPDATE search_queries SET runs=1 WHERE user_id=?").run("local-radar");

    const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    f.net.setItems([
      serviceItem("201", { price: 1500 }), // novo, no orçamento e recente -> alerta
      serviceItem("202", { price: 5000 }), // fora do orçamento -> sem alerta
      serviceItem("203", { price: 1600, publishedAt: stale }), // antigo -> sem alerta
    ]);
    await f.scan();
    await f.tick();

    const alerts = f.sql
      .prepare("SELECT data FROM alerts")
      .all() as { data: string }[];
    assert.equal(alerts.length, 1);
    const alert = JSON.parse(alerts[0].data) as { price: number };
    assert.equal(alert.price, 1500);
  } finally {
    f.sql.close();
  }
});

test("hotfix: coleta sem anúncios válidos é informada ao dono/admin sem vazar segredos", async () => {
  const f = await harness();
  try {
    // A fonte respondeu, mas nenhum item é um anúncio válido do Marketplace.
    f.net.setItems([
      { url: "https://example.com/not-a-listing", title: "irrelevante" },
    ]);
    await f.scan();
    const tick = (await (await f.tick()).json()) as {
      results: { status: string; error: string; phase: string }[];
    };
    assert.equal(tick.results[0].status, "dead");
    assert.match(tick.results[0].error, /Nenhum registro válido/);

    // Nada foi persistido como anúncio.
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM listings").get()!.n, 0);
    assert.equal(
      f.sql.prepare("SELECT status FROM provider_runs").get()!.status,
      "failed",
    );

    // Dono/admin recebe orientação e motivo técnico; usuário comum só orientação.
    const admin = await bootstrap(
      f.db,
      { kind: "user", userId: "local-radar", admin: true },
      cfg,
      true,
    );
    const lastError = admin.searches[0].operational.lastError!;
    assert.ok(lastError);
    assert.match(lastError.action, /rejeitados|diagnóstico/i);
    assert.match(lastError.technical!, /Nenhum registro válido/);

    const ordinary = await bootstrap(
      f.db,
      { kind: "user", userId: "local-radar", admin: false },
      cfg,
      true,
    );
    assert.equal(ordinary.searches[0].operational.lastError?.technical, null);

    // Nenhum segredo vaza no bootstrap.
    assert.equal(JSON.stringify(admin).includes(cfg.SCRAPER_URL), false);
    assert.equal(JSON.stringify(admin).includes(cfg.WORKER_TOKEN), false);
  } finally {
    f.sql.close();
  }
});

test("hotfix: o cartão da busca mostra o que fazer e o motivo técnico, sem segredos", async () => {
  const f = await harness();
  try {
    f.net.setItems([
      { url: "https://example.com/not-a-listing", title: "irrelevante" },
    ]);
    await f.scan();
    await f.tick();
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SearchList } = await import("../components/saas/search-list");
    const b = await bootstrap(
      f.db,
      { kind: "user", userId: "local-radar", admin: true },
      cfg,
      true,
    );
    const html = renderToStaticMarkup(
      createElement(SearchList, {
        bootstrap: b,
        onEdit() {},
        onCreate() {},
        onRefresh() {},
      }),
    );
    assert.match(html, /O que fazer/);
    assert.match(html, /Motivo técnico desta tentativa/);
    assert.match(html, /Nenhum registro válido/);
    assert.equal(html.includes(cfg.SCRAPER_URL), false);
    assert.equal(html.includes(cfg.WORKER_TOKEN), false);
  } finally {
    f.sql.close();
  }
});
