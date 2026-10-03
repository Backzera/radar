import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../server/http";
import type { MediaStore } from "../server/inventory";
import {
  addDays,
  itemFigures,
  parseMoneyToCents,
  periodRange,
  summarize,
  todayIn,
  type SummaryItem,
} from "../core/brick";
import { database } from "./fixtures";

const ORIGIN = "http://localhost";
// API bodies are checked field by field below; loose typing keeps that readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type ApiResponse = Omit<Response, "json"> & { json(): Promise<Json> };
const CONFIG = {
  AUTH_MODE: "password",
  ALLOW_LOCAL_DEV_AUTH: "true",
  RADAR_ADMIN_EMAILS: "dono@example.test",
};
function memoryMedia() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  const store: MediaStore = {
    async put(key, value, options) {
      objects.set(key, {
        bytes: new Uint8Array(value),
        type: options?.httpMetadata?.contentType,
      });
    },
    async get(key) {
      const o = objects.get(key);
      return o
        ? { body: new Response(o.bytes as unknown as BodyInit).body! }
        : null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
  };
  return { store, objects };
}
function app(config: Record<string, string> = CONFIG) {
  const { db } = database();
  const media = memoryMedia();
  const handler = createHandler(db, config, {
    development: true,
    media: media.store,
  });
  const call = async (
    path: string,
    init: {
      method?: string;
      body?: unknown;
      cookie?: string;
      type?: string;
      origin?: string;
    } = {},
  ) => {
    const headers: Record<string, string> = {
      origin: init.origin ?? ORIGIN,
    };
    if (init.cookie) headers.cookie = init.cookie;
    if (init.body !== undefined)
      headers["content-type"] = init.type ?? "application/json";
    const response = await handler(
      new Request(`${ORIGIN}/api/v1/${path}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers,
        body:
          init.body === undefined
            ? undefined
            : init.body instanceof Uint8Array
              ? (init.body as unknown as BodyInit)
              : JSON.stringify(init.body),
      }),
    );
    return response as unknown as ApiResponse;
  };
  const signup = async (email = "ana@example.test", name = "Ana") => {
    const r = await call("auth/signup", {
      body: { name, email, password: "senha-forte-123", acceptTerms: true },
    });
    assert.equal(r.status, 201);
    return r.headers.get("set-cookie")!.split(";")[0];
  };
  return { db, call, signup, media };
}
const today = todayIn();
const item = (overrides: Record<string, unknown> = {}) => ({
  name: "iPhone 13 128GB",
  category: "phones",
  brand: "Apple",
  model: "iPhone 13",
  condition: "used",
  purchasePriceCents: 150000,
  purchasedAt: addDays(today, -10),
  purchaseChannel: "facebook",
  askingPriceCents: 210000,
  ...overrides,
});
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);

test("brick: lucro, margem, ROI e dias só depois da venda; antes, lucro esperado", () => {
  const base = {
    purchasePriceCents: 100000,
    costsCents: 15000,
    askingPriceCents: 160000,
    saleFeesCents: 5000,
    purchasedAt: "2026-09-01",
  };
  const open = itemFigures(
    { ...base, status: "listed", salePriceCents: null, soldAt: null },
    "2026-09-21",
  );
  assert.equal(open.investedCents, 115000);
  assert.equal(open.profitCents, null);
  assert.equal(open.expectedProfitCents, 45000);
  assert.equal(open.days, 20);
  const sold = itemFigures(
    { ...base, status: "sold", salePriceCents: 150000, soldAt: "2026-09-11" },
    "2026-09-21",
  );
  assert.equal(sold.profitCents, 30000);
  assert.equal(sold.marginPct, 20);
  assert.equal(sold.roiPct, 26.1);
  assert.equal(sold.days, 10);
  assert.equal(sold.expectedProfitCents, null);
});

test("brick: valor digitado em reais vira centavos sem erro de arredondamento", () => {
  assert.equal(parseMoneyToCents("1.850"), 185000);
  assert.equal(parseMoneyToCents("1.850,50"), 185050);
  assert.equal(parseMoneyToCents("R$ 2.100,9"), 210090);
  assert.equal(parseMoneyToCents("19.99"), 1999);
  assert.equal(parseMoneyToCents("-5"), null);
  assert.equal(parseMoneyToCents(""), null);
});

test("brick: períodos e resumo comparam com o período anterior, meta e itens parados", () => {
  assert.deepEqual(periodRange("month", "2026-01-15"), {
    start: "2026-01-01",
    end: "2026-01-15",
    previous: { start: "2025-12-01", end: "2025-12-31" },
  });
  const sale = (id: string, soldAt: string, profit: number): SummaryItem => ({
    id,
    name: id,
    category: "phones",
    coverPhotoId: null,
    status: "sold",
    purchasePriceCents: 100000,
    costsCents: 0,
    askingPriceCents: null,
    salePriceCents: 100000 + profit,
    saleFeesCents: 0,
    purchasedAt: "2026-08-01",
    soldAt,
  });
  const s = summarize(
    [
      sale("a", "2026-09-05", 30000),
      sale("b", "2026-09-20", 20000),
      sale("c", "2026-08-10", 25000),
      {
        ...sale("d", "2026-09-01", 0),
        status: "in_stock",
        salePriceCents: null,
        soldAt: null,
        askingPriceCents: 130000,
        purchasedAt: "2026-07-01",
      },
    ],
    { period: "month", today: "2026-09-25", goalCents: 100000, staleAfterDays: 30 },
  );
  assert.equal(s.sales.profitCents, 50000);
  assert.equal(s.sales.count, 2);
  assert.equal(s.sales.profitChangePct, 100);
  assert.equal(s.goal?.pct, 50);
  assert.equal(s.stock.count, 1);
  assert.equal(s.stock.expectedProfitCents, 30000);
  assert.deepEqual(s.stale.map((x) => x.id), ["d"]);
  assert.equal(s.months.length, 12);
  assert.equal(s.months.at(-1)?.month, "2026-09");
  assert.equal(s.months.at(-1)?.profitCents, 50000);
  assert.equal(s.months.at(-2)?.profitCents, 25000);
});

test("auth: cadastro abre sessão, e-mail repetido é recusado, senha errada não revela a conta", async () => {
  const { call, signup } = app();
  const cookie = await signup();
  assert.match(cookie, /^brick_session=[A-Za-z0-9_-]{43}$/);
  const me = await (await call("auth/me", { cookie })).json();
  assert.equal(me.user.email, "ana@example.test");
  assert.equal(me.user.name, "Ana");
  const again = await call("auth/signup", {
    body: { name: "Outra", email: "ANA@example.test", password: "outra-senha-1", acceptTerms: true },
  });
  assert.equal(again.status, 409);
  const wrong = await call("auth/login", {
    body: { email: "ana@example.test", password: "senha-errada" },
  });
  const unknown = await call("auth/login", {
    body: { email: "ninguem@example.test", password: "senha-errada" },
  });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal((await wrong.json()).error, (await unknown.json()).error);
  const login = await call("auth/login", {
    body: { email: " Ana@Example.test ", password: "senha-forte-123" },
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);
});

test("auth: sair invalida a sessão; sem cookie, o modo password não cai no acesso local", async () => {
  const { call, signup } = app();
  const cookie = await signup();
  assert.equal((await call("inventory", { cookie })).status, 200);
  const out = await call("auth/logout", { body: {}, cookie });
  assert.match(out.headers.get("set-cookie")!, /Max-Age=0/);
  assert.equal((await call("inventory", { cookie })).status, 401);
  assert.equal((await call("inventory")).status, 401);
  assert.equal(
    (await call("inventory", { cookie: "brick_session=" + "a".repeat(43) })).status,
    401,
  );
});

test("auth: cadastro de outra origem, sem aceite dos termos ou com senha curta é recusado", async () => {
  const { call } = app();
  const body = { name: "Ana", email: "ana@example.test", password: "senha-forte-123", acceptTerms: true };
  assert.equal(
    (await call("auth/signup", { body, origin: "https://evil.example" })).status,
    403,
  );
  assert.equal(
    (await call("auth/signup", { body: { ...body, acceptTerms: false } })).status,
    422,
  );
  assert.equal(
    (await call("auth/signup", { body: { ...body, password: "curta" } })).status,
    422,
  );
});

test("estoque: cadastra, lista, edita com versão, lança custo, vende e entra no painel", async () => {
  const { call, signup } = app();
  const cookie = await signup();
  const created = await (await call("inventory", { cookie, body: item() })).json();
  assert.equal(created.status, "in_stock");
  assert.equal(created.figures.expectedProfitCents, 60000);
  const list = await (await call("inventory?status=open", { cookie })).json();
  assert.equal(list.total, 1);
  assert.equal(list.counts.in_stock, 1);
  const edited = await call(`inventory/${created.id}`, {
    cookie,
    body: { askingPriceCents: 220000, expectedVersion: created.version },
  });
  assert.equal(edited.status, 200);
  const stale = await call(`inventory/${created.id}`, {
    cookie,
    body: { name: "Outro nome", expectedVersion: created.version },
  });
  assert.equal(stale.status, 409);
  const withCost = await (
    await call(`inventory/${created.id}/costs`, {
      cookie,
      body: { kind: "repair", description: "Troca de bateria", amountCents: 12000, spentAt: today },
    })
  ).json();
  assert.equal(withCost.figures.investedCents, 162000);
  assert.equal(withCost.costs.length, 1);
  const sold = await (
    await call(`inventory/${created.id}/sell`, {
      cookie,
      body: { salePriceCents: 205000, soldAt: today, saleChannel: "olx", saleFeesCents: 3000 },
    })
  ).json();
  assert.equal(sold.status, "sold");
  assert.equal(sold.figures.profitCents, 40000);
  const summary = await (await call("inventory/summary?period=month", { cookie })).json();
  assert.equal(summary.sales.profitCents, 40000);
  assert.equal(summary.sales.count, 1);
  const back = await (await call(`inventory/${created.id}/unsell`, { cookie, body: {} })).json();
  assert.equal(back.status, "listed");
  assert.equal(back.salePriceCents, null);
});

test("estoque: venda antes da compra, data futura e item de outra conta são recusados", async () => {
  const { call, signup } = app();
  const ana = await signup();
  const bia = await signup("bia@example.test", "Bia");
  const created = await (await call("inventory", { cookie: ana, body: item() })).json();
  const early = await call(`inventory/${created.id}/sell`, {
    cookie: ana,
    body: { salePriceCents: 200000, soldAt: addDays(today, -20), saleChannel: "olx" },
  });
  assert.equal(early.status, 422);
  const future = await call("inventory", {
    cookie: ana,
    body: item({ purchasedAt: addDays(today, 5) }),
  });
  assert.equal(future.status, 422);
  assert.equal((await call(`inventory/${created.id}`, { cookie: bia })).status, 404);
  assert.equal(
    (await call(`inventory/${created.id}`, { cookie: bia, method: "DELETE", body: {} })).status,
    404,
  );
  assert.equal((await (await call("inventory", { cookie: bia })).json()).total, 0);
});

test("fotos: só imagem de verdade entra, é servida ao dono e sai junto com o produto", async () => {
  const { call, signup, media } = app();
  const ana = await signup();
  const bia = await signup("bia@example.test", "Bia");
  const created = await (await call("inventory", { cookie: ana, body: item() })).json();
  const fake = await call(`inventory/${created.id}/photos`, {
    cookie: ana,
    body: new TextEncoder().encode("<svg onload=alert(1)>"),
    type: "image/png",
  });
  assert.equal(fake.status, 415);
  const asJson = await call(`inventory/${created.id}/photos`, { cookie: ana, body: {} });
  assert.equal(asJson.status, 415);
  const uploaded = await call(`inventory/${created.id}/photos`, {
    cookie: ana,
    body: PNG,
    type: "image/png",
  });
  assert.equal(uploaded.status, 201);
  const withPhoto = await uploaded.json();
  assert.equal(withPhoto.photos.length, 1);
  assert.equal(media.objects.size, 1);
  const served = await call(`media/${withPhoto.photos[0].id}`, { cookie: ana });
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), PNG);
  assert.equal((await call(`media/${withPhoto.photos[0].id}`, { cookie: bia })).status, 404);
  await call(`inventory/${created.id}`, { cookie: ana, method: "DELETE", body: {} });
  assert.equal(media.objects.size, 0);
});

test("exportação: planilha com cabeçalho em português e sem fórmula injetada", async () => {
  const { call, signup } = app();
  const cookie = await signup();
  await call("inventory", { cookie, body: item({ name: "=HYPERLINK(\"x\")" }) });
  const csv = await call("inventory/export.csv", { cookie });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition")!, /estoque-\d{4}-\d{2}-\d{2}\.csv/);
  const bytes = new Uint8Array(await csv.arrayBuffer());
  // UTF-8 BOM: Excel needs it to read accents; text() would strip it.
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.startsWith("Produto;Categoria"));
  assert.match(text, /"'=HYPERLINK\(""x""\)"/);
  assert.match(text, /1500,00/);
});

test("preferências: meta mensal e prazo de item parado são salvos e aparecem no painel", async () => {
  const { call, signup } = app();
  const cookie = await signup();
  const saved = await call("brick/preferences", {
    cookie,
    body: { monthlyGoalCents: 300000, staleAfterDays: 45 },
  });
  assert.equal(saved.status, 200);
  const summary = await (await call("inventory/summary", { cookie })).json();
  assert.equal(summary.goal.targetCents, 300000);
  assert.equal(summary.goal.achievedCents, 0);
});
