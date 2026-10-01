import test from "node:test";
import assert from "node:assert/strict";
import { normalize, priceAnomalies } from "../core/normalize";
import { matchesMonitor } from "../core/opportunity";
import { state, saveMonitor } from "../server/service";
import { fixture, monitor, database } from "./fixtures";
import type { Monitor } from "../core/types";

test("F01: reconhece Fifine A8 e MacBook Intel sem inventar variante", () => {
  assert.equal(
    normalize({ title: "Microfone Fifine A8 USB usado", description: "" })
      .model,
    "Fifine A8",
  );
  const mac = normalize({
    title: "MacBook Pro 2017 i5 256GB usado",
    description: "",
  });
  assert.equal(mac.model, "MacBook Pro 2017");
  assert.equal(mac.storage, 256);
  assert.equal(
    mac.key,
    null,
    "Tela/variante Intel ainda incompleta para comparáveis",
  );
});
test("F03: troca na descrição não troca identidade nem armazenamento", () => {
  const p = normalize({
    title: "iPhone 15 128GB usado",
    description: "Troco por Samsung Galaxy S23 256GB.",
  });
  assert.equal(p.model, "iPhone 15");
  assert.equal(p.storage, 128);
});
test("F04: negação de entrada/parcelas não rejeita preço total", () => {
  assert.deepEqual(
    priceAnomalies(
      "iPhone 15 128GB",
      "R$ 2.500 pelo aparelho completo, sem entrada ou parcelas.",
    ),
    [],
  );
  for (const d of [
    "entrada de R$ 500",
    "10 parcelas de R$ 250",
    "entrada facilitada",
    "10x de R$ 250",
  ])
    assert.ok(priceAnomalies("iPhone 15", d).length, d);
});
test("F02: exclusão contextual distingue acessório incluído, bloqueio e negação", () => {
  const { listing } = fixture();
  const m = {
    ...monitor,
    negatives: ["capinha", "icloud"],
    negativeMode: "contextual",
  } as Monitor;
  assert.equal(
    matchesMonitor(
      {
        ...listing,
        description: "Acompanha capinha grátis. Sem bloqueio de iCloud.",
      },
      m,
    ),
    true,
  );
  assert.equal(
    matchesMonitor({ ...listing, description: "Bloqueado no iCloud" }, m),
    false,
  );
  assert.equal(
    matchesMonitor({ ...listing, title: "Vendo somente capinha iPhone 15" }, m),
    false,
  );
});
test("F05: pesquisa integral parametrizada trata caracteres especiais e separa contas", async () => {
  const { db, sql, createUser } = database();
  await createUser();
  await createUser("u2");
  for (const q of ["iPhone", "%", "_", "\\", "'", "ação", ""]) {
    const s = await state(db, "u1", q);
    assert.equal(s.opportunities.length, 0);
  }
  sql.close();
});

test("F07: edição parcial preserva campos invisíveis e rejeita versão obsoleta", async () => {
  const { db, createUser } = database();
  await createUser();
  const m = await saveMonitor(db, "u1", {
    name: "Radar teste",
    query: "iPhone 15",
    minPrice: 199.99,
    manualPrice: 3000,
    minLiquidity: 10,
    latitude: -25,
    longitude: -49,
    city: "Curitiba",
  });
  const saved = await saveMonitor(
    db,
    "u1",
    { name: "Outro nome", expectedVersion: m.version },
    m.id,
  );
  for (const key of [
    "minPrice",
    "manualPrice",
    "minLiquidity",
    "latitude",
    "longitude",
    "city",
  ] as const)
    assert.equal(saved[key], m[key]);
  await assert.rejects(
    saveMonitor(
      db,
      "u1",
      { name: "Desatualizado", expectedVersion: m.version },
      m.id,
    ),
    /CONFLICT/,
  );
  await assert.rejects(
    saveMonitor(db, "u2", { name: "Outro cliente" }, m.id),
    /NOT_FOUND/,
  );
  const cleared = await saveMonitor(
    db,
    "u1",
    { latitude: null, longitude: null, expectedVersion: saved.version },
    m.id,
  );
  assert.equal(cleared.latitude, null);
});
