import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../core/brick";
import { app, item, query, today, type Json } from "./api-app";

const grill = (overrides: Record<string, unknown> = {}) =>
  item({
    name: "Churrasqueira Weber 57cm",
    category: "other",
    brand: "Weber",
    model: null,
    purchasePriceCents: 30000,
    askingPriceCents: 55000,
    ...overrides,
  });
const sale = (salePriceCents: number, soldTo: string) => ({
  salePriceCents,
  soldAt: today,
  saleChannel: "whatsapp",
  soldTo,
});

test("unidades: 4 churrasqueiras de uma vez, 2 vendidas e 2 em estoque, cada uma com seu preço", async () => {
  const { call, signup } = app();
  const ana = await signup("ana@example.test", "Ana");
  const created = await call("inventory", {
    cookie: ana,
    body: grill({
      units: [
        { purchasePriceCents: 30000, sale: sale(55000, "João") },
        // Desconto para a Maria.
        { purchasePriceCents: 30000, sale: sale(50000, "Maria") },
        { purchasePriceCents: 28000 },
        { purchasePriceCents: 32000 },
      ],
    }),
  });
  assert.equal(created.status, 201);
  const first = await created.json();
  assert.equal(first.status, "sold");
  assert.equal(first.soldTo, "João");
  assert.equal(first.group.units, 4);
  assert.equal(first.group.position, 1);
  assert.equal(first.group.sold, 2);
  assert.equal(first.group.open, 2);
  assert.equal(first.group.revenueCents, 105000);
  assert.equal(first.group.profitCents, 45000);
  assert.equal(first.group.openInvestedCents, 60000);
  assert.deepEqual(first.group.list.map((u: Json) => u.purchasePriceCents), [30000, 30000, 28000, 32000]);

  // Estoque agrupado: um cartão só, com os números das 4 unidades.
  const open = await (await call(`inventory?${query({ status: "open", grouped: "1" })}`, { cookie: ana })).json();
  assert.equal(open.total, 1);
  assert.equal(open.items[0].group.units, 4);
  assert.equal(open.items[0].status, "in_stock");
  assert.equal(open.counts.in_stock, 2);
  assert.equal(open.counts.sold, 2);
  // Sem agrupar (vendas, painel): cada unidade é um negócio.
  const sold = await (await call(`inventory?${query({ status: "sold", sort: "sold" })}`, { cookie: ana })).json();
  assert.deepEqual(sold.items.map((i: Json) => i.soldTo).sort(), ["João", "Maria"]);
  assert.ok(sold.items.every((i: Json) => i.group === null));
  const summary = await (await call("inventory/summary?period=month", { cookie: ana })).json();
  assert.equal(summary.sales.count, 2);
  assert.equal(summary.sales.profitCents, 45000);
  assert.equal(summary.stock.count, 2);

  const owner = await signup("dono@example.test", "Dono");
  const trail = await (await call(`admin/activity?${query({ group: "items" })}`, { cookie: owner })).json();
  const summaries = trail.events.map((e: Json) => e.summary);
  assert.equal(summaries.filter((s: string) => /unidade \d de 4/.test(s)).length, 4);
});

test("unidades: adicionar a um produto já cadastrado, renomear vale para todas, cada venda é separada", async () => {
  const { call, signup } = app();
  const ana = await signup("ana@example.test", "Ana");
  const single = await (await call("inventory", { cookie: ana, body: grill() })).json();
  assert.equal(single.group, null);
  const added = await call(`inventory/${single.id}/units`, {
    cookie: ana,
    body: { units: [{ purchasePriceCents: 25000 }, { purchasePriceCents: 27000, sale: sale(45000, "Pedro") }] },
  });
  assert.equal(added.status, 201);
  const grouped = await added.json();
  assert.equal(grouped.group.units, 3);
  assert.equal(grouped.group.sold, 1);
  const [, second, third] = grouped.group.list;
  assert.equal(second.purchasePriceCents, 25000);
  assert.equal(third.soldTo, "Pedro");

  const renamed = await (
    await call(`inventory/${single.id}`, {
      cookie: ana,
      body: { name: "Churrasqueira Weber Original 57cm", purchasePriceCents: 31000, expectedVersion: grouped.version },
    })
  ).json();
  assert.equal(renamed.purchasePriceCents, 31000);
  const other = await (await call(`inventory/${second.id}`, { cookie: ana })).json();
  // O nome acompanha; o preço pago é de cada unidade.
  assert.equal(other.name, "Churrasqueira Weber Original 57cm");
  assert.equal(other.purchasePriceCents, 25000);

  const discounted = await (
    await call(`inventory/${second.id}/sell`, { cookie: ana, body: sale(40000, "Carla") })
  ).json();
  assert.equal(discounted.figures.profitCents, 15000);
  assert.equal(discounted.group.sold, 2);
  assert.equal(discounted.group.revenueCents, 85000);
  const first = await (await call(`inventory/${single.id}`, { cookie: ana })).json();
  assert.equal(first.status, "in_stock");
});

test("unidades: juntar cadastros feitos um a um e separar de volta", async () => {
  const { call, signup } = app();
  const ana = await signup("ana@example.test", "Ana");
  const bia = await signup("bia@example.test", "Bia");
  const a = await (await call("inventory", { cookie: ana, body: grill() })).json();
  const b = await (await call("inventory", { cookie: ana, body: grill({ name: "  churrasqueira WEBER 57cm ", purchasePriceCents: 29000 }) })).json();
  await call("inventory", { cookie: ana, body: grill({ name: "Churrasqueira a bafo" }) });
  const strange = await (await call("inventory", { cookie: bia, body: grill() })).json();

  // Mesmo nome (sem diferenciar maiúsculas e espaços) aparece como sugestão; de outra conta, nunca.
  const detail = await (await call(`inventory/${a.id}`, { cookie: ana })).json();
  assert.deepEqual(detail.similar.map((s: Json) => s.id), [b.id]);
  assert.equal((await call(`inventory/${a.id}/group`, { cookie: ana, body: { ids: [strange.id] } })).status, 404);

  const joined = await (await call(`inventory/${a.id}/group`, { cookie: ana, body: { ids: [b.id] } })).json();
  assert.equal(joined.group.units, 2);
  assert.deepEqual(joined.similar, []);
  const other = await (await call(`inventory/${b.id}`, { cookie: ana })).json();
  assert.equal(other.name, "Churrasqueira Weber 57cm");
  assert.equal(other.purchasePriceCents, 29000);
  const list = await (await call(`inventory?${query({ grouped: "1", status: "" })}`, { cookie: ana })).json();
  assert.equal(list.total, 2);

  // Separar a última unidade desfaz o grupo: sobram dois produtos comuns.
  const left = await (await call(`inventory/${b.id}/group`, { cookie: ana, method: "DELETE", body: {} })).json();
  assert.equal(left.group, null);
  assert.equal((await (await call(`inventory/${a.id}`, { cookie: ana })).json()).group, null);
});

test("unidades: cadastro solto entra no grupo que já existe e o grupo mantém o nome", async () => {
  const { call, signup } = app();
  const ana = await signup("ana@example.test", "Ana");
  const group = await (
    await call("inventory", {
      cookie: ana,
      body: grill({ units: [{ purchasePriceCents: 30000 }, { purchasePriceCents: 31000 }, { purchasePriceCents: 32000 }] }),
    })
  ).json();
  const loose = await (await call("inventory", { cookie: ana, body: grill({ name: "churrasqueira weber 57CM", purchasePriceCents: 26000 }) })).json();
  const detail = await (await call(`inventory/${loose.id}`, { cookie: ana })).json();
  // As 3 unidades do grupo aparecem, marcadas com o grupo (a tela conta como 1 cadastro).
  assert.equal(detail.similar.length, 3);
  assert.ok(detail.similar.every((s: Json) => s.groupId === group.group.id));
  const joined = await (
    await call(`inventory/${loose.id}/group`, { cookie: ana, body: { ids: detail.similar.map((s: Json) => s.id) } })
  ).json();
  assert.equal(joined.group.id, group.group.id);
  assert.equal(joined.group.units, 4);
  assert.equal(joined.name, "Churrasqueira Weber 57cm");
  assert.equal(joined.purchasePriceCents, 26000);
});

test("unidades: limites e datas são conferidos em cada unidade", async () => {
  const { call, signup } = app();
  const ana = await signup("ana@example.test", "Ana");
  const many = Array.from({ length: 51 }, () => ({ purchasePriceCents: 1000 }));
  assert.equal((await call("inventory", { cookie: ana, body: grill({ units: many }) })).status, 422);
  const early = await call("inventory", {
    cookie: ana,
    body: grill({
      purchasedAt: today,
      units: [{ purchasePriceCents: 1000 }, { purchasePriceCents: 1000, sale: { ...sale(2000, "X"), soldAt: addDays(today, -3) } }],
    }),
  });
  assert.equal(early.status, 422);
  // Nada foi criado pela metade.
  const list = await (await call("inventory?status=", { cookie: ana })).json();
  assert.equal(list.total, 0);
});
