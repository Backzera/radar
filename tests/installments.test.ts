import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../core/brick";
import { app, item, query, today, type Json } from "./api-app";

const phone = (overrides: Record<string, unknown> = {}) =>
  item({ name: "Redmi Note 12", purchasePriceCents: 35000, askingPriceCents: 60000, purchasedAt: addDays(today, -20), ...overrides });
const credit = (installments: [number, string][], downPaymentCents = 0) => ({
  downPaymentCents,
  installments: installments.map(([amountCents, dueDate]) => ({ amountCents, dueDate })),
});
const sell = (salePriceCents: number, plan?: object, soldAt = today) => ({
  salePriceCents,
  soldAt,
  saleChannel: "whatsapp",
  soldTo: "Carlos",
  ...(plan ? { plan } : {}),
});

test("crediário: R$ 600 com R$ 200 de entrada e 2 parcelas de R$ 200; receber uma por vez", async () => {
  const { call, signup } = app();
  const ana = await signup("ana@example.test", "Ana");
  const created = await (await call("inventory", { cookie: ana, body: phone() })).json();
  const [first, second] = [addDays(today, 24), addDays(today, 55)];
  const sold = await (
    await call(`inventory/${created.id}/sell`, {
      cookie: ana,
      body: sell(60000, credit([[20000, first], [20000, second]], 20000)),
    })
  ).json();
  // A venda conta inteira no lucro; o que falta receber fica à parte.
  assert.equal(sold.figures.profitCents, 25000);
  assert.equal(sold.installmentCount, 2);
  assert.equal(sold.receivableCents, 40000);
  assert.deepEqual(
    sold.installments.map((p: Json) => [p.number, p.amountCents, p.dueDate, p.paidAt, p.state]),
    [
      [0, 20000, today, today, "paid"],
      [1, 20000, first, null, "open"],
      [2, 20000, second, null, "open"],
    ],
  );
  const summary = await (await call("inventory/summary", { cookie: ana })).json();
  assert.equal(summary.receivables.openCents, 40000);
  assert.equal(summary.receivables.openCount, 2);
  assert.equal(summary.receivables.overdueCents, 0);

  const list = await (await call("inventory/receivables", { cookie: ana })).json();
  assert.deepEqual(list.installments.map((p: Json) => [p.number, p.of, p.dueDate, p.soldTo]), [
    [1, 2, first, "Carlos"],
    [2, 2, second, "Carlos"],
  ]);
  const firstId = list.installments[0].id;
  const paid = await (
    await call(`inventory/${created.id}/installments/${firstId}`, { cookie: ana, body: { paid: true } })
  ).json();
  assert.equal(paid.receivableCents, 20000);
  assert.equal(paid.installments[1].paidAt, today);
  const after = await (await call("inventory/summary", { cookie: ana })).json();
  assert.equal(after.receivables.openCents, 20000);
  assert.equal(after.receivables.receivedThisMonthCents, 20000);
  const received = await (await call(`inventory/receivables?${query({ status: "paid" })}`, { cookie: ana })).json();
  assert.equal(received.installments.length, 1);
  // Desfazer o recebimento volta a parcela para em aberto.
  const undone = await (
    await call(`inventory/${created.id}/installments/${firstId}`, { cookie: ana, body: { paid: false } })
  ).json();
  assert.equal(undone.receivableCents, 40000);

  const owner = await signup("dono@example.test", "Dono");
  const trail = await (await call(`admin/activity?${query({ group: "sales" })}`, { cookie: owner })).json();
  const summaries = trail.events.map((e: Json) => e.summary);
  assert.ok(summaries.some((s: string) => /parcelado: entrada R\$\s200,00 \+ 2x/.test(s)));
  assert.ok(summaries.some((s: string) => /Recebeu a parcela 1 de 2 de Redmi Note 12/.test(s)));
});

test("crediário: soma errada, parcela antes da venda, entrada e parcela de outra conta são recusadas", async () => {
  const { call, signup } = app();
  const ana = await signup("ana@example.test", "Ana");
  const bia = await signup("bia@example.test", "Bia");
  const created = await (await call("inventory", { cookie: ana, body: phone() })).json();
  const wrong = await call(`inventory/${created.id}/sell`, {
    cookie: ana,
    body: sell(60000, credit([[20000, addDays(today, 30)]], 20000)),
  });
  assert.equal(wrong.status, 422);
  assert.match((await wrong.json()).error, /somam R\$\s400,00, mas a venda foi de R\$\s600,00/);
  const early = await call(`inventory/${created.id}/sell`, {
    cookie: ana,
    body: sell(60000, credit([[60000, addDays(today, -1)]])),
  });
  assert.equal(early.status, 422);
  // Nada foi gravado pelas tentativas recusadas.
  assert.equal((await (await call(`inventory/${created.id}`, { cookie: ana })).json()).status, "in_stock");

  const sold = await (
    await call(`inventory/${created.id}/sell`, { cookie: ana, body: sell(60000, credit([[40000, addDays(today, 30)]], 20000)) })
  ).json();
  const down = sold.installments.find((p: Json) => p.number === 0);
  assert.equal((await call(`inventory/${created.id}/installments/${down.id}`, { cookie: ana, body: { paid: false } })).status, 422);
  const part = sold.installments.find((p: Json) => p.number === 1);
  assert.equal((await call(`inventory/${created.id}/installments/${part.id}`, { cookie: bia, body: { paid: true } })).status, 404);
});

test("crediário: parcela vencida aparece como atrasada; editar a venda mantém o que já foi recebido", async () => {
  const { call, signup } = app();
  const ana = await signup("ana@example.test", "Ana");
  const created = await (await call("inventory", { cookie: ana, body: phone() })).json();
  const soldAt = addDays(today, -15);
  const late = addDays(today, -5);
  const next = addDays(today, 15);
  const sold = await (
    await call(`inventory/${created.id}/sell`, {
      cookie: ana,
      body: sell(60000, credit([[30000, late], [30000, next]]), soldAt),
    })
  ).json();
  assert.deepEqual(sold.installments.map((p: Json) => p.state), ["overdue", "open"]);
  const overdue = await (await call(`inventory/receivables?${query({ status: "overdue" })}`, { cookie: ana })).json();
  assert.equal(overdue.installments.length, 1);
  assert.equal(overdue.totals.overdueCents, 30000);
  assert.equal(overdue.totals.overdueCount, 1);

  await call(`inventory/${created.id}/installments/${sold.installments[0].id}`, { cookie: ana, body: { paid: true } });
  // Renegociou a segunda parcela: a primeira continua recebida.
  const edited = await (
    await call(`inventory/${created.id}/sell`, {
      cookie: ana,
      body: sell(60000, credit([[30000, late], [30000, addDays(today, 40)]]), soldAt),
    })
  ).json();
  assert.equal(edited.installments[0].paidAt, today);
  assert.equal(edited.installments[1].dueDate, addDays(today, 40));
  assert.equal(edited.receivableCents, 30000);

  // Virou venda à vista: as parcelas somem.
  const cash = await (await call(`inventory/${created.id}/sell`, { cookie: ana, body: sell(60000, undefined, soldAt) })).json();
  assert.deepEqual(cash.installments, []);
  assert.equal(cash.receivableCents, 0);
  await call(`inventory/${created.id}/sell`, { cookie: ana, body: sell(60000, credit([[60000, next]]), soldAt) });
  const unsold = await (await call(`inventory/${created.id}/unsell`, { cookie: ana, body: {} })).json();
  assert.deepEqual(unsold.installments, []);
  const totals = await (await call("inventory/summary", { cookie: ana })).json();
  assert.equal(totals.receivables.openCents, 0);
});
