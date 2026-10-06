import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHandler } from "../server/http";
import type { MediaStore } from "../server/inventory";
import { addDays, todayIn } from "../core/brick";
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
const today = todayIn();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
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

function app() {
  const { db } = database();
  const objects = new Map<string, Uint8Array>();
  const media: MediaStore = {
    async put(key, value) {
      objects.set(key, new Uint8Array(value));
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { body: new Response(o as unknown as BodyInit).body! } : null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
  };
  const handler = createHandler(db, CONFIG, { development: true, media });
  const call = async (
    path: string,
    init: { method?: string; body?: unknown; cookie?: string; type?: string; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = { origin: ORIGIN, ...init.headers };
    if (init.cookie) headers.cookie = init.cookie;
    if (init.body !== undefined) headers["content-type"] = init.type ?? "application/json";
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
  const signup = async (email: string, name: string) => {
    const r = await call("auth/signup", {
      body: { name, email, password: "senha-forte-123", acceptTerms: true },
    });
    assert.equal(r.status, 201);
    return r.headers.get("set-cookie")!.split(";")[0];
  };
  const userId = async (owner: string, email: string) => {
    const { users } = await (await call("admin/users", { cookie: owner })).json();
    return users.find((u: Json) => u.email === email).id as string;
  };
  return { db, call, signup, userId };
}
const query = (values: Record<string, string>) => new URLSearchParams(values).toString();

test("auditoria: cada mudança no produto vira um registro legível, com valores e antes/depois", async () => {
  const { call, signup, userId } = app();
  const owner = await signup("dono@example.test", "Dono");
  const customer = await signup("cliente@example.test", "Cliente");
  const created = await (await call("inventory", { cookie: customer, body: item() })).json();
  await call(`inventory/${created.id}`, {
    cookie: customer,
    body: { purchasePriceCents: 140000, expectedVersion: created.version },
  });
  await call(`inventory/${created.id}/status`, { cookie: customer, body: { status: "listed" } });
  await call(`inventory/${created.id}/costs`, {
    cookie: customer,
    body: { kind: "repair", description: "Tela", amountCents: 5000, spentAt: today },
  });
  await call(`inventory/${created.id}/photos`, { cookie: customer, body: PNG, type: "image/png" });
  await call(`inventory/${created.id}/sell`, {
    cookie: customer,
    body: { salePriceCents: 200000, soldAt: today, saleChannel: "olx" },
  });
  await call(`inventory/${created.id}/unsell`, { cookie: customer, body: {} });
  // Saving without changes adds nothing to the trail.
  const current = await (await call(`inventory/${created.id}`, { cookie: customer })).json();
  await call(`inventory/${created.id}`, {
    cookie: customer,
    body: { name: current.name, expectedVersion: current.version },
  });
  await call(`inventory/${created.id}`, { cookie: customer, method: "DELETE", body: {} });

  assert.equal((await call("admin/activity", { cookie: customer })).status, 403);
  const trail = await (await call(`admin/activity?${query({ item: created.id })}`, { cookie: owner })).json();
  assert.deepEqual(
    trail.events.map((e: Json) => e.action).reverse(),
    ["item_created", "item_updated", "item_status", "cost_added", "photo_added", "item_sold", "item_unsold", "item_deleted"],
  );
  const by = Object.fromEntries(trail.events.map((e: Json) => [e.action, e]));
  assert.match(by.item_created.summary, /Cadastrou iPhone 13 128GB · compra R\$\s1\.500,00/);
  assert.match(by.item_updated.summary, /valor pago R\$\s1\.500,00 → R\$\s1\.400,00/);
  assert.deepEqual(by.item_updated.details.changes.map((c: Json) => c.field), ["purchasePriceCents"]);
  assert.match(by.item_status.summary, /de Em estoque para Anunciado/);
  assert.match(by.cost_added.summary, /conserto R\$\s50,00 \(Tela\)/);
  // 2.000 - 1.400 - 50 = 550 de lucro.
  assert.match(by.item_sold.summary, /por R\$\s2\.000,00 · lucro R\$\s550,00/);
  assert.match(by.item_unsold.summary, /era R\$\s2\.000,00/);
  assert.match(by.item_deleted.summary, /Excluiu iPhone 13 128GB/);
  assert.equal(by.item_deleted.details.item.costsCents, 5000);
  assert.equal(by.item_deleted.user.email, "cliente@example.test");
  assert.equal(by.item_deleted.warning, true);
  // The person filter finds the account's own events; the group filter narrows them.
  const id = await userId(owner, "cliente@example.test");
  const sales = await (await call(`admin/activity?${query({ user: id, group: "sales" })}`, { cookie: owner })).json();
  assert.deepEqual(sales.events.map((e: Json) => e.action).sort(), ["item_sold", "item_unsold"]);
  const search = await (await call(`admin/activity?${query({ q: "conserto" })}`, { cookie: owner })).json();
  assert.equal(search.total, 1);
});

test("auditoria: acessos, senha errada, conta bloqueada e ações do admin ficam registrados com IP", async () => {
  const { call, signup, userId } = app();
  const owner = await signup("dono@example.test", "Dono");
  await signup("cliente@example.test", "Cliente");
  const visitor = { "cf-connecting-ip": "203.0.113.7", "user-agent": "Teste/1.0" };
  const login = (password: string, email = "cliente@example.test") =>
    call("auth/login", { body: { email, password }, headers: visitor });
  assert.equal((await login("errada-123")).status, 401);
  assert.equal((await login("qualquer", "ninguem@example.test")).status, 401);
  const ok = await login("senha-forte-123");
  assert.equal(ok.status, 200);
  await call("auth/logout", { cookie: ok.headers.get("set-cookie")!.split(";")[0], body: {}, headers: visitor });
  const id = await userId(owner, "cliente@example.test");
  await call(`admin/users/${encodeURIComponent(id)}/status`, { cookie: owner, body: { status: "blocked" } });
  assert.equal((await login("senha-forte-123")).status, 403);
  await call(`admin/users/${encodeURIComponent(id)}/plan`, { cookie: owner, body: { plan: "pro" } });

  const access = await (await call(`admin/activity?${query({ group: "access" })}`, { cookie: owner })).json();
  const actions = access.events.map((e: Json) => e.action);
  for (const action of ["account_created", "login_failed", "login", "logout", "login_blocked"])
    assert.ok(actions.includes(action), action);
  const failed = access.events.filter((e: Json) => e.action === "login_failed");
  assert.equal(failed.length, 2);
  assert.ok(failed.every((e: Json) => e.ip === "203.0.113.7" && e.userAgent === "Teste/1.0" && e.warning));
  // Unknown e-mail: recorded without an account and with the address masked.
  const unknown = failed.find((e: Json) => e.user === null);
  assert.match(unknown.summary, /n\*\*\*@example\.test/);
  const admin = await (await call(`admin/activity?${query({ group: "admin" })}`, { cookie: owner })).json();
  const blocked = admin.events.find((e: Json) => e.action === "admin_user_blocked");
  assert.equal(blocked.actor.email, "dono@example.test");
  assert.equal(blocked.user.email, "cliente@example.test");
  assert.match(blocked.summary, /Bloqueou o acesso de Cliente/);
  assert.ok(admin.events.some((e: Json) => /Mudou o plano de Cliente para Pro/.test(e.summary)));
});

test("auditoria: visão geral soma faturamento e lucro por usuário e da plataforma", async () => {
  const { call, signup } = app();
  const owner = await signup("dono@example.test", "Dono");
  const ana = await signup("ana@example.test", "Ana");
  const bia = await signup("bia@example.test", "Bia");
  const sell = async (cookie: string, buy: number, sale: number) => {
    const created = await (
      await call("inventory", { cookie, body: item({ purchasePriceCents: buy, purchasedAt: today }) })
    ).json();
    await call(`inventory/${created.id}/sell`, {
      cookie,
      body: { salePriceCents: sale, soldAt: today, saleChannel: "olx", saleFeesCents: 1000 },
    });
  };
  await sell(ana, 100000, 150000);
  await sell(ana, 50000, 80000);
  await sell(bia, 200000, 190000);
  await call("inventory", { cookie: bia, body: item({ purchasePriceCents: 70000 }) });
  assert.equal((await call("admin/overview", { cookie: ana })).status, 403);
  const overview = await (await call("admin/overview?period=month", { cookie: owner })).json();
  // Revenue is the sale price; profit takes out cost and fees.
  assert.equal(overview.sales.revenueCents, 150000 + 80000 + 190000);
  assert.equal(overview.sales.profitCents, 49000 + 29000 - 11000);
  assert.equal(overview.sales.count, 3);
  assert.equal(overview.stock.count, 1);
  assert.equal(overview.stock.investedCents, 70000);
  const byEmail = Object.fromEntries(overview.users.map((u: Json) => [u.email, u]));
  assert.equal(byEmail["ana@example.test"].revenueCents, 230000);
  assert.equal(byEmail["ana@example.test"].profitCents, 78000);
  assert.equal(byEmail["ana@example.test"].soldCount, 2);
  assert.equal(byEmail["bia@example.test"].profitCents, -11000);
  assert.equal(byEmail["bia@example.test"].stockCount, 1);
  assert.equal(byEmail["bia@example.test"].registeredInPeriod, 2);
  assert.equal(overview.users[0].email, "ana@example.test");
  assert.equal(overview.platform.users, 3);
  assert.equal(overview.platform.itemsRegistered, 4);
  assert.equal(overview.months.at(-1).revenueCents, 420000);
});

test("auditoria: produtos de todos os usuários com dono, filtros, foto e planilha", async () => {
  const { call, signup } = app();
  const owner = await signup("dono@example.test", "Dono");
  const ana = await signup("ana@example.test", "Ana");
  const bia = await signup("bia@example.test", "Bia");
  const phone = await (await call("inventory", { cookie: ana, body: item() })).json();
  await call("inventory", { cookie: bia, body: item({ name: "PS5 Slim", category: "consoles" }) });
  const photo = await (
    await call(`inventory/${phone.id}/photos`, { cookie: ana, body: PNG, type: "image/png" })
  ).json();
  const everything = await (await call("admin/items", { cookie: owner })).json();
  assert.equal(everything.total, 2);
  assert.equal(everything.totals.investedCents, 300000);
  const found = await (await call("admin/items?q=bia", { cookie: owner })).json();
  assert.deepEqual(found.items.map((i: Json) => [i.name, i.owner.email]), [["PS5 Slim", "bia@example.test"]]);
  // The admin sees any user's photo; a user still sees only their own.
  const cover = everything.items.find((i: Json) => i.id === phone.id).coverPhotoId;
  assert.equal(cover, photo.photos[0].id);
  assert.equal((await call(`admin/media/${encodeURIComponent(cover)}`, { cookie: owner })).status, 200);
  assert.equal((await call(`admin/media/${encodeURIComponent(cover)}`, { cookie: bia })).status, 403);
  assert.equal((await call(`media/${encodeURIComponent(cover)}`, { cookie: bia })).status, 404);
  const csv = await call("admin/items/export.csv?status=open", { cookie: owner });
  assert.equal(csv.status, 200);
  const text = await csv.text();
  // text() drops the BOM that makes Excel read the file as UTF-8.
  assert.match(text, /^Usuário;E-mail;Cadastrado em;Produto/);
  assert.match(text, /;\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2};PS5 Slim;/);
  assert.equal(text.trim().split("\r\n").length, 3);
  const exports = await (await call("admin/activity?group=exports", { cookie: owner })).json();
  assert.match(exports.events[0].summary, /Exportou 2 produtos/);
});

test("auditoria: a migração traz o histórico de antes (contas, produtos, vendas e ações do admin)", () => {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort();
  for (const f of files.filter((f) => f < "0009")) db.exec(readFileSync(`drizzle/${f}`, "utf8"));
  const at = "2026-09-01T12:00:00.000Z";
  db.exec(`
    INSERT INTO users (id,created_at,settings,demo_seeded) VALUES ('u1','${at}','{}',0);
    INSERT INTO accounts (user_id,created_at) VALUES ('u1','${at}');
    INSERT INTO auth_credentials (user_id,email,name,password_hash,password_salt,iterations,created_at,updated_at)
      VALUES ('u1','ana@example.test','Ana','h','s',1,'${at}','${at}');
    INSERT INTO inventory_items (id,user_id,name,category,condition,notes,status,purchase_price_cents,purchased_at,
      purchase_channel,sale_price_cents,sale_fees_cents,sold_at,sale_channel,version,created_at,updated_at)
      VALUES ('i1','u1','Notebook Dell','computers','used','','sold',123456,'2026-09-01','olx',250000,0,'2026-09-05','olx',1,'${at}','${at}'),
             ('i2','u1','Fone JBL','audio','used','','in_stock',9900,'2026-09-02','olx',NULL,0,NULL,NULL,1,'${at}','${at}');
    INSERT INTO audit_events (id,actor_id,subject_id,action,created_at) VALUES ('a1','admin','u1','plan_pro','${at}');
  `);
  db.exec(readFileSync("drizzle/0009_activity_log.sql", "utf8"));
  const rows = db
    .prepare("SELECT action,summary,user_id FROM activity_log ORDER BY action,summary")
    .all() as { action: string; summary: string; user_id: string }[];
  assert.deepEqual(
    rows.map((r) => [r.action, r.summary]),
    [
      ["account_created", "Criou a conta"],
      ["admin_plan_changed", "Mudou o plano para Pro"],
      ["item_created", "Cadastrou Fone JBL · compra R$ 99,00"],
      ["item_created", "Cadastrou Notebook Dell · compra R$ 1.234,56"],
      ["item_sold", "Vendeu Notebook Dell por R$ 2.500,00"],
    ],
  );
  assert.ok(rows.every((r) => r.user_id === "u1"));
});
