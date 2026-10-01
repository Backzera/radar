import test from "node:test";
import assert from "node:assert/strict";
import { database, fixture, monitor } from "./fixtures";
import { listingStatement, getMonitors } from "../server/store";
import { getFeed } from "../server/feed";
import { saveSearch } from "../server/searches";
import { saveMonitor, state } from "../server/service";
import { ensureUser } from "../server/seed";
import {
  reserveAccountBudget,
  refundAccountBudget,
  tenantBudgetKey,
  cancelAccount,
} from "../server/accounts";
import { createHandler } from "../server/http";
import {
  authenticate,
  readBoundedJson,
  verifyAccess,
} from "../server/security";
import { createTelegramLink, acceptTelegramUpdate } from "../server/channels";
import { deliverOne } from "../server/notifications";
import { analyze } from "../core/opportunity";
import { DEFAULT_SETTINGS } from "../core/types";
import { normalize } from "../core/normalize";
import { providerBudgetKey } from "../server/pilot";
const config = {
  AUTH_MODE: "platform",
  TRUST_PLATFORM_IDENTITY: "true",
  PLATFORM_ORIGIN_TOKEN: "local-test-origin-token-".repeat(3),
  WORKER_TOKEN: "local-test-worker-token-".repeat(3),
  COLLECTION_ENABLED: "false",
};
const req = (path: string, user = "u1", body?: unknown) =>
  new Request("https://radar.invalid/api/v1/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "oai-authenticated-user-id": user,
      "x-radar-origin-token": config.PLATFORM_ORIGIN_TOKEN,
      origin: "https://radar.invalid",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
async function seed(
  db: ReturnType<typeof database>["db"],
  n = 60,
  user = "u1",
) {
  await ensureUser(db, user);
  await saveMonitor(db, user, {
    name: "Teste pessoal",
    query: "iPhone 15",
    intent: "personal",
    maxPrice: 3000,
    city: "",
    negativeMode: "contextual",
  });
  const { listing } = fixture(),
    time = new Date().toISOString();
  for (let i = 0; i < n; i++) {
    const l = {
      ...listing,
      id: `${user}-${i}`,
      externalId: `${user}-${i}`,
      sellerId: `seller-${i}`,
      fingerprint: `fp-${i}`,
      url: `https://www.facebook.com/marketplace/item/${i + 1000}/`,
      originalUrl: `https://www.facebook.com/marketplace/item/${i + 1000}/`,
      title: `iPhone 15 128 GB usado ${i === 0 ? "ação 100%_\\" : "item " + i}`,
      description: "Aparelho usado funcionando. Sem bloqueio de iCloud.",
      price: 2000 + i,
      baseline: true,
      firstSeenAt: time,
      lastSeenAt: time,
      publishedAt: time,
      publicationStatus: "valid" as const,
    };
    await listingStatement(db, user, { ...l, product: normalize(l) }).run();
  }
}
test("F06: filtro/ordenação globais antes da página, payload limitado, invalidação e conta isolada", async () => {
  const { db, sql } = database();
  await seed(db);
  await seed(db, 2, "u2");
  const first = await getFeed(db, "u1", { limit: 25, sort: "price" });
  assert.equal(first.total, 60);
  assert.equal(first.items.length, 25);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 300000);
  assert.equal(first.items[0].listing.price, 2000);
  assert.equal(
    first.items.flatMap((o) => o.analysis.pricing.comparables).length,
    0,
  );
  const next = await getFeed(db, "u1", { limit: 25, page: 2, sort: "price" });
  assert.equal(next.items[0].listing.price, 2025);
  assert.equal(
    new Set([...first.items, ...next.items].map((o) => o.listing.id)).size,
    50,
  );
  for (const q of ["ação", "100%_\\"])
    assert.equal((await getFeed(db, "u1", { q })).total, 1);
  assert.equal((await getFeed(db, "u2", {})).total, 2);
  const generation = sql
    .prepare("SELECT generation FROM feed_state WHERE user_id=?")
    .get("u1")!.generation;
  await getFeed(db, "u1", {});
  assert.equal(
    sql.prepare("SELECT generation FROM feed_state WHERE user_id=?").get("u1")!
      .generation,
    generation,
  );
  const m = (await getMonitors(db, "u1"))[0];
  await saveMonitor(
    db,
    "u1",
    { maxPrice: 2010, expectedVersion: m.version },
    m.id,
  );
  assert.equal((await getFeed(db, "u1", { filter: "budget" })).total, 11);
  assert.notEqual(
    sql.prepare("SELECT generation FROM feed_state WHERE user_id=?").get("u1")!
      .generation,
    generation,
  );
  sql.close();
});
test("F05: pesquisa legada com linha real escapa %, _, barra e aspas", async () => {
  const { db, sql } = database();
  await seed(db, 2);
  for (const q of ["100%_\\", "ação", "%", "_", "\\"])
    assert.equal((await state(db, "u1", q)).opportunities.length, 1, q);
  assert.equal((await state(db, "u1", "' OR 1=1 --")).opportunities.length, 0);
  sql.close();
});
test("F01/F02/F04: busca genérica não aprova finanças nem aceita parcela/acessório com risco permissivo", () => {
  const { listing } = fixture(),
    raw = {
      ...listing,
      title: "Torneira Gourmet Modelo X usada",
      description: "Funcionando normalmente",
      price: 400,
    };
  const l = { ...raw, product: normalize(raw) },
    m = {
      ...monitor,
      query: "Torneira Gourmet Modelo X",
      city: "",
      intent: "personal" as const,
      identificationMode: "generic" as const,
      maxPrice: 500,
      maxRisk: 100,
    };
  const a = analyze(l, [l], DEFAULT_SETTINGS, m, new Date(l.publishedAt!));
  assert.equal(a.budgetEligible, true);
  assert.equal(a.eligible, false);
  assert.equal(a.classification, "within_budget");
  const part = { ...l, description: "Entrada de R$ 400 e mais parcelas" };
  assert.equal(
    analyze(part, [part], DEFAULT_SETTINGS, m).budgetEligible,
    false,
  );
  const accessory = {
    ...l,
    title: "Vendo somente capinha iPhone 15 128GB",
    description: "",
  };
  assert.equal(
    analyze(accessory, [accessory], DEFAULT_SETTINGS, {
      ...m,
      query: "iPhone 15",
      maxPrice: 500,
    }).budgetEligible,
    false,
  );
});
test("criação idempotente, colisão de payload e limite atômico de buscas por conta", async () => {
  const { db, sql } = database();
  await ensureUser(db, "u1");
  sql.prepare("UPDATE plans SET max_active=1 WHERE id='managed'").run();
  const key = crypto.randomUUID(),
    input = {
      requestKey: key,
      config: { name: "Minha busca", query: "Fifine A8", intervalSeconds: 300 },
    };
  const first = await saveSearch(db, "u1", input),
    again = await saveSearch(db, "u1", input);
  assert.equal(again.monitor.id, first.monitor.id);
  assert.equal(again.replayed, true);
  assert.equal((await getMonitors(db, "u1")).length, 1);
  await assert.rejects(
    saveSearch(db, "u1", {
      ...input,
      config: { ...input.config, query: "Fifine K688" },
    }),
    /outros critérios/,
  );
  await assert.rejects(
    saveSearch(db, "u1", { ...input, requestKey: crypto.randomUUID() }),
    /PLAN_LIMIT/,
  );
  const paused = await saveSearch(db, "u1", {
    requestKey: crypto.randomUUID(),
    config: { ...input.config, active: false },
  });
  await assert.rejects(
    saveSearch(
      db,
      "u1",
      { config: { active: true }, expectedVersion: paused.monitor.version },
      paused.monitor.id,
    ),
    /PLAN_LIMIT/,
  );
  sql.close();
});
test("reserva de cota global e individual é conjunta, concorrente e reembolsável uma vez", async () => {
  const { db, sql } = database();
  await ensureUser(db, "u1");
  await ensureUser(db, "u2");
  const reservations = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      reserveAccountBudget(db, "u1", "r" + i, "brightdata", 5, 2),
    ),
  );
  assert.equal(reservations.filter(Boolean).length, 2);
  const u2 = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      reserveAccountBudget(db, "u2", "b" + i, "brightdata", 5, 5),
    ),
  );
  assert.equal(u2.filter(Boolean).length, 3);
  assert.equal(
    sql
      .prepare("SELECT count FROM rate_limits WHERE key=?")
      .get(providerBudgetKey("brightdata"))!.count,
    5,
  );
  await refundAccountBudget(db, "u2", "r0");
  assert.equal(
    sql
      .prepare("SELECT count FROM rate_limits WHERE key=?")
      .get(providerBudgetKey("brightdata"))!.count,
    5,
  );
  await refundAccountBudget(db, "u1", "r0");
  await refundAccountBudget(db, "u1", "r0");
  assert.equal(
    sql
      .prepare("SELECT count FROM rate_limits WHERE key=?")
      .get(providerBudgetKey("brightdata"))!.count,
    4,
  );
  assert.equal(
    sql
      .prepare("SELECT count FROM rate_limits WHERE key=?")
      .get(tenantBudgetKey("u1"))!.count,
    1,
  );
  sql.close();
});
test("API: negar identidade forjada, CSRF, acesso cruzado, administração e token fora do worker", async () => {
  const { db, sql } = database();
  await seed(db, 2);
  await ensureUser(db, "u2");
  const handle = createHandler(db, config);
  assert.equal(
    (
      await handle(
        new Request("https://radar.invalid/api/v1/bootstrap", {
          headers: { "oai-authenticated-user-id": "u1" },
        }),
      )
    ).status,
    401,
  );
  assert.equal((await handle(req("listings/u1-0", "u2"))).status, 404);
  assert.equal((await handle(req("admin/status", "u1"))).status, 403);
  assert.equal(
    (await handle(req("listing-preferences/u1-0", "u2", { saved: true })))
      .status,
    404,
  );
  assert.equal(
    (
      await handle(
        new Request("https://radar.invalid/api/v1/bootstrap", {
          headers: { authorization: "Bearer " + config.WORKER_TOKEN },
        }),
      )
    ).status,
    403,
  );
  const csrf = req("draft", "u1", { step: 0, values: {} });
  csrf.headers.set("origin", "https://attacker.invalid");
  assert.equal((await handle(csrf)).status, 403);
  const huge = req("draft", "u1", {
    step: 0,
    values: { text: "é".repeat(20000) },
  });
  assert.equal((await handle(huge)).status, 413);
  const b = (await (await handle(req("bootstrap"))).json()) as Record<
    string,
    unknown
  >;
  assert.equal(JSON.stringify(b).includes(config.PLATFORM_ORIGIN_TOKEN), false);
  assert.equal("diagnostics" in b, false);
  assert.equal(
    (
      await handle(
        req("scan", "u1", {
          monitorId: (await getMonitors(db, "u1"))[0].id,
          confirmConsumption: true,
        }),
      )
    ).status,
    503,
  );
  sql.close();
});
test("rascunho, salvo, descarte, compra/venda, cancelamento e exportação persistem sem vazamento", async () => {
  const { db, sql } = database();
  await seed(db, 2);
  const handle = createHandler(db, config);
  assert.equal(
    (
      await handle(
        req("draft", "u1", {
          step: 2,
          values: { product: "Fifine A8", city: "Curitiba" },
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    ((await (await handle(req("draft"))).json()) as { step: number }).step,
    2,
  );
  assert.equal(
    (await handle(req("listing-preferences/u1-0", "u1", { saved: true })))
      .status,
    200,
  );
  assert.equal((await getFeed(db, "u1", { filter: "saved" })).total, 1);
  await handle(
    req("listing-preferences/u1-0", "u1", {
      dismissed: true,
      reason: "Modelo incorreto",
    }),
  );
  assert.equal((await getFeed(db, "u1", { filter: "dismissed" })).total, 1);
  assert.equal(
    (
      await handle(
        req("feedback", "u1", {
          listingId: "u1-0",
          type: "bought",
          paid: 1999.99,
          costs: 20,
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await handle(
        req("feedback", "u1", {
          listingId: "u1-0",
          type: "sold",
          soldFor: 2500,
          additionalCosts: 10,
        }),
      )
    ).status,
    200,
  );
  const canceled = await cancelAccount(db, "u1", "CANCELAR ACESSO");
  assert.equal(canceled.deleted, false);
  assert.equal((await getMonitors(db, "u1"))[0].active, false);
  assert.equal(
    sql.prepare("SELECT COUNT(*) AS n FROM listings WHERE user_id='u1'").get()!
      .n,
    2,
  );
  assert.equal(
    (await handle(req("account/export?section=listings", "u2"))).status,
    200,
  );
  sql.close();
});
test("limite real de bytes e auth local desligada por padrão", async () => {
  await assert.rejects(
    readBoundedJson(
      new Request("https://test.invalid", {
        method: "POST",
        body: JSON.stringify({ value: "é".repeat(20) }),
      }),
      32,
    ),
    /tamanho/,
  );
  assert.equal(
    await authenticate(
      new Request("http://localhost/api/v1/bootstrap"),
      {},
      true,
    ),
    null,
  );
  assert.equal(
    await authenticate(
      new Request("https://example.com/api/v1/bootstrap"),
      { ALLOW_LOCAL_DEV_AUTH: "true" },
      true,
    ),
    null,
  );
  assert.equal(
    (
      await authenticate(
        new Request("http://localhost/api/v1/bootstrap"),
        { ALLOW_LOCAL_DEV_AUTH: "true" },
        true,
      )
    )?.userId,
    "local-radar",
  );
});
test("JWT Access: assinatura, emissor, audiência, expiração e algoritmo obrigatórios", async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const key = {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      kid: "local-fixture",
    },
    issuer = "https://example.cloudflareaccess.com",
    now = Math.floor(Date.now() / 1000);
  const b64 = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  async function token(claims: Record<string, unknown> = {}, alg = "RS256") {
    const start =
      b64({ alg, kid: key.kid }) +
      "." +
      b64({
        iss: issuer,
        aud: ["radar-audience"],
        sub: "user",
        iat: now,
        exp: now + 60,
        type: "app",
        ...claims,
      });
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(start),
    );
    return start + "." + Buffer.from(sig).toString("base64url");
  }
  assert.equal(
    (await verifyAccess(await token(), issuer, "radar-audience", [key])).sub,
    "user",
  );
  for (const claims of [
    { exp: now - 1 },
    { aud: ["other"] },
    { iss: "https://evil.invalid" },
    { type: "service" },
    { nbf: now + 1000 },
  ])
    await assert.rejects(
      verifyAccess(await token(claims), issuer, "radar-audience", [key]),
    );
  await assert.rejects(
    verifyAccess(await token({}, "none"), issuer, "radar-audience", [key]),
  );
  const good = await token();
  await assert.rejects(
    verifyAccess(good.slice(0, -10) + "AAAAAAAAAA", issuer, "radar-audience", [
      key,
    ]),
  );
});
test("Telegram: token temporário de vínculo não é armazenado em claro nem aceito com segredo errado", async () => {
  const { db, sql } = database();
  await ensureUser(db, "u1");
  sql.prepare("UPDATE plans SET telegram=1 WHERE id='managed'").run();
  const cfg = {
    EXTERNAL_ALERTS_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "synthetic-not-a-real-token",
    TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret-".repeat(3),
    TELEGRAM_BOT_USERNAME: "radar_test_bot",
  };
  const link = await createTelegramLink(db, "u1", cfg),
    token = new URL(link.url).searchParams.get("start")!;
  assert.equal(
    sql.prepare("SELECT token_hash FROM channel_tokens").get()!.token_hash ===
      token,
    false,
  );
  const input = {
    message: {
      chat: { id: 123, type: "private" },
      from: { id: 123, is_bot: false },
      text: "/start " + token,
    },
  };
  await assert.rejects(
    acceptTelegramUpdate(db, new Request("https://test.invalid"), input, cfg),
    /não autenticado/,
  );
  const r = new Request("https://test.invalid", {
    headers: { "x-telegram-bot-api-secret-token": cfg.TELEGRAM_WEBHOOK_SECRET },
  });
  assert.equal((await acceptTelegramUpdate(db, r, input, cfg)).accepted, true);
  assert.equal((await acceptTelegramUpdate(db, r, input, cfg)).accepted, false);
  assert.equal(
    sql.prepare("SELECT user_id FROM notification_destinations").get()!.user_id,
    "u1",
  );
  sql.close();
});
test("F11: envio abandonado vira incerto sem reenvio ou interferência na outra conta", async () => {
  const { db, sql } = database();
  await ensureUser(db, "u1");
  await ensureUser(db, "u2");
  sql
    .prepare(
      "INSERT INTO notification_outbox(id,user_id,alert_id,channel,status,attempts,available_at,lease_until) VALUES ('out1','u1','a','telegram','sending',1,?,?),('out2','u2','b','telegram','sending',1,?,?)",
    )
    .run("2000-01-01", "2000-01-01", "2000-01-01", "2000-01-01");
  let sends = 0;
  await deliverOne(db, "u1", {
    async send() {
      sends++;
    },
  });
  assert.equal(sends, 0);
  assert.equal(
    sql.prepare("SELECT status FROM notification_outbox WHERE id='out1'").get()!
      .status,
    "uncertain",
  );
  assert.equal(
    sql.prepare("SELECT status FROM notification_outbox WHERE id='out2'").get()!
      .status,
    "sending",
  );
  sql.close();
});
