import test from "node:test";
import assert from "node:assert/strict";
import { database, monitor, now } from "./fixtures";
import { ingest, materialize } from "../server/ingestion";
import { DEFAULT_SETTINGS } from "../core/types";
import {
  demoBaseline as generatedBaseline,
  demoNew as generatedNew,
  MockProvider as DemoMock,
} from "./mock";
const real = (r: ReturnType<typeof generatedNew>) => ({
  ...r,
  demo: false,
  provider: "brightdata",
});
const demoBaseline = (now: Date) => generatedBaseline(now).map(real);
const demoNew = (...args: Parameters<typeof generatedNew>) =>
  real(generatedNew(...args));
class MockProvider extends DemoMock {
  async search(r: import("../providers/contract").SearchRequest) {
    const result = await super.search(r);
    return { ...result, items: result.items.map(real) };
  }
}
import { ProviderError } from "../providers/contract";
import { getListings, getAlerts, listingStatement } from "../server/store";
import { enqueue, runOne } from "../server/worker";
import { saveFeedback, saveMonitor, state } from "../server/service";
test("ciclo completo: baseline, novo, preço, score e alerta idempotente", async () => {
  const { db, createUser } = database();
  await createUser();
  const first = await ingest(
    db,
    "u1",
    monitor,
    demoBaseline(now),
    true,
    DEFAULT_SETTINGS,
    now,
  );
  assert.equal(first.alerts, 0);
  const raw = demoNew(0, 0, now);
  const fresh = await ingest(
    db,
    "u1",
    monitor,
    [raw],
    false,
    DEFAULT_SETTINGS,
    now,
  );
  assert.equal(fresh.discoveries, 1);
  assert.equal(fresh.alerts, 1);
  const again = await ingest(
    db,
    "u1",
    monitor,
    [raw],
    false,
    DEFAULT_SETTINGS,
    new Date(+now + 10000),
  );
  assert.equal(again.discoveries, 0);
  assert.equal(again.alerts, 0);
  assert.equal((await getAlerts(db, "u1")).length, 1);
  assert.equal((await getListings(db, "u1")).length, 61);
});
test("baseline por monitor impede backlog no segundo poll", async () => {
  const { db, createUser } = database();
  await createUser();
  await ingest(
    db,
    "u1",
    monitor,
    demoBaseline(now),
    true,
    DEFAULT_SETTINGS,
    now,
  );
  const raw = demoNew(0, 0, now);
  await ingest(db, "u1", monitor, [raw], false, DEFAULT_SETTINGS, now, false);
  const other = { ...monitor, id: "m2" };
  await ingest(db, "u1", other, [raw], true, DEFAULT_SETTINGS, now);
  const r = await ingest(
    db,
    "u1",
    other,
    [raw],
    false,
    DEFAULT_SETTINGS,
    new Date(+now + 60000),
  );
  assert.equal(r.alerts, 0);
});
test("anúncio fora do monitor não alerta mesmo com bom preço", async () => {
  const { db, createUser } = database();
  await createUser();
  await ingest(
    db,
    "u1",
    monitor,
    demoBaseline(now),
    true,
    DEFAULT_SETTINGS,
    now,
  );
  assert.equal(
    (
      await ingest(
        db,
        "u1",
        { ...monitor, city: "São Paulo" },
        [demoNew(0, 0, now)],
        false,
        DEFAULT_SETTINGS,
        now,
      )
    ).alerts,
    0,
  );
});
test("deduplicação funciona fora da janela dos 1000 comparáveis", async () => {
  const { db, createUser } = database();
  await createUser();
  const raw = demoNew(0, 0, now);
  const old = materialize(raw, true, new Date(+now - 86400000));
  await listingStatement(db, "u1", old).run();
  for (let i = 0; i < 1001; i++) {
    const l = materialize(
      { ...raw, externalId: `other-${i}`, url: `https://demo.invalid/${i}` },
      true,
      now,
    );
    await listingStatement(db, "u1", l).run();
  }
  const r = await ingest(db, "u1", monitor, [raw], true, DEFAULT_SETTINGS, now);
  assert.equal(r.discoveries, 0);
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM listings")
    .first<{ n: number }>();
  assert.equal(count?.n, 1002);
});
test("isolamento por usuário e snapshots só em mudança", async () => {
  const { db, createUser } = database();
  await createUser();
  await createUser("u2");
  const raw = demoNew(0, 0, now);
  await ingest(db, "u1", monitor, [raw], true, DEFAULT_SETTINGS, now);
  await ingest(db, "u1", monitor, [raw], true, DEFAULT_SETTINGS, now);
  assert.equal((await getListings(db, "u2")).length, 0);
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM listing_snapshots")
        .first<{ n: number }>()
    )?.n,
    1,
  );
  await assert.rejects(
    saveFeedback(db, "u2", {
      listingId: (await getListings(db, "u1"))[0].id,
      type: "passed",
    }),
    /NOT_FOUND/,
  );
});
test("scheduler persiste job, não duplica e conclui baseline após sucesso", async () => {
  const { db, createUser } = database();
  await createUser();
  const m = Object.fromEntries(
    Object.entries(monitor).filter(([k]) => !["id", "revision"].includes(k)),
  );
  await saveMonitor(
    db,
    "u1",
    Object.fromEntries(Object.entries(m).filter(([k]) => k !== "revision")),
  );
  assert.equal(await enqueue(db, "u1", true), 1);
  assert.equal(await enqueue(db, "u1", true), 0);
  const result = await runOne(db, "u1", () => new MockProvider());
  assert.equal(result.status, "done");
  assert.equal(
    (
      await db
        .prepare("SELECT baseline_complete AS n FROM monitor_scopes")
        .first<{ n: number }>()
    )?.n,
    1,
  );
});
test("falha de provider mantém baseline incompleto e DLQ distingue erro permanente", async () => {
  const { db, createUser } = database();
  await createUser();
  const m = Object.fromEntries(
    Object.entries(monitor).filter(([k]) => !["id", "revision"].includes(k)),
  );
  await saveMonitor(db, "u1", m);
  await enqueue(db, "u1", true);
  const broken = new MockProvider();
  broken.search = async () => {
    throw new ProviderError("Credencial inválida", false);
  };
  const r = await runOne(db, "u1", () => broken);
  assert.equal(r.status, "dead");
  assert.equal(
    (
      await db
        .prepare("SELECT baseline_complete AS n FROM monitor_scopes")
        .first<{ n: number }>()
    )?.n,
    0,
  );
  assert.equal((await getAlerts(db, "u1")).length, 0);
});
test("compra e venda persistem resultado real, sem chamar desaparecimento de venda", async () => {
  const { db, createUser } = database();
  await createUser();
  await ingest(
    db,
    "u1",
    monitor,
    [demoNew(0, 0, now)],
    true,
    DEFAULT_SETTINGS,
    now,
  );
  const l = (await getListings(db, "u1"))[0];
  await saveFeedback(db, "u1", {
    listingId: l.id,
    type: "bought",
    paid: 2100,
    costs: 150,
  });
  await saveFeedback(db, "u1", {
    listingId: l.id,
    type: "sold",
    soldFor: 2850,
    costs: 180,
  });
  const row = await db
    .prepare("SELECT data FROM purchases")
    .first<{ data: string }>();
  const p = JSON.parse(row!.data);
  assert.equal(p.soldFor - p.paid - p.costs, 570);
  assert.equal((await getListings(db, "u1"))[0].availability, "active");
});
test("operação real começa vazia e nunca cria seed na leitura", async () => {
  const { db } = database();
  for (let i = 0; i < 2; i++) {
    const d = await state(db, "real-user");
    assert.equal(d.totalListings, 0);
    assert.equal(d.monitors.length, 0);
    assert.equal(d.alerts.length, 0);
    assert.equal(d.realMode, true);
  }
});

test("falha de preflight permite retry sem tratar como disparo ambíguo", async () => {
  const { db, createUser } = database();
  await createUser();
  await saveMonitor(db, "u1", {
    name: "iPhone",
    query: "iPhone 15",
    provider: "brightdata",
  });
  await enqueue(db, "u1", true);
  const provider = new MockProvider();
  let first = true;
  provider.search = async () => {
    if (first) {
      first = false;
      const e = new ProviderError("HTTP 429", true, 1);
      e.phase = "preflight";
      throw e;
    }
    return { items: [], complete: true, warnings: [] };
  };
  const result = await runOne(db, "u1", () => provider);
  assert.equal(result.status, "retry");
  const j = await db
    .prepare("SELECT payload FROM jobs")
    .first<{ payload: string }>();
  assert.equal(JSON.parse(j!.payload).triggerStarted, false);
  await db.prepare("UPDATE jobs SET available_at='2000-01-01T00:00:00Z'").run();
  assert.equal((await runOne(db, "u1", () => provider)).status, "done");
});
