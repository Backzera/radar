import test from "node:test";
import assert from "node:assert/strict";
import { database, fixture, monitor, now } from "./fixtures";
import { DEFAULT_SETTINGS, type Alert, type Listing } from "../core/types";
import { priceListing } from "../core/pricing";
import { groupPricer } from "../core/pricing-context";
import { analyze } from "../core/opportunity";
import { financialCeilingFor, purchasePolicy } from "../core/purchase-policy";
import { deliverOne, DeliveryRejected } from "../server/notifications";
import { listingStatement } from "../server/store";
import { ensureUser } from "../server/seed";
import { runSchedulerTick } from "../server/supervisor";
import { pilotConfig } from "../server/pilot";
import { saveMonitor } from "../server/service";
import { enqueue } from "../server/worker";
import type { MarketplaceProvider } from "../providers/contract";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const noComparables = (p: ReturnType<typeof priceListing>) => ({
  ...p,
  comparables: [],
});
test("F06: contexto de preço mantém equivalência com algoritmo exato e exclusão do próprio anúncio", () => {
  const base = fixture().listing;
  for (const duplicates of [false, true]) {
    const pool: Listing[] = Array.from({ length: 45 }, (_, i) => ({
      ...base,
      id: `p${i}`,
      price: 2200 + (i % 3) * 10,
      sellerId: duplicates && i % 5 === 0 ? "shared" : `s${i}`,
      fingerprint: duplicates && i % 7 === 0 ? "shared" : `f${i}`,
      city: i % 4 === 0 ? "São Paulo" : "Curitiba",
      lastSeenAt: new Date(
        +now - (i % 6 === 0 ? 40 : 1) * 86400000,
      ).toISOString(),
      availability: i % 5 === 0 ? "unknown" : i % 11 === 0 ? "sold" : "active",
      product: { ...base.product, condition: i % 9 === 0 ? "new" : "used" },
    }));
    const context = groupPricer(pool, DEFAULT_SETTINGS, now, 0.95);
    for (const l of pool)
      for (const minRoi of [0, 20, 37.5]) {
        const m = { ...monitor, minRoi };
        assert.deepEqual(
          context(l, m),
          noComparables(
            priceListing(l, pool, { ...DEFAULT_SETTINGS, minRoi }, now, 0.95),
          ),
        );
        const expected = analyze(l, pool, DEFAULT_SETTINGS, m, now, 0.95);
        expected.pricing.comparables = [];
        assert.deepEqual(
          analyze(l, pool, DEFAULT_SETTINGS, m, now, 0.95, context(l, m)),
          expected,
        );
      }
  }
});
test("Prévia financeira usa os mesmos centavos e arredondamento conservador do servidor", () => {
  const p = priceListing(
    fixture().listing,
    fixture().pool,
    DEFAULT_SETTINGS,
    now,
  );
  for (const sale of [2500.01, 3000.99, 99.95]) {
    const m = {
      ...monitor,
      mode: "manual" as const,
      expectedQuickSalePrice: sale,
      minProfit: 20.37,
      costs: { ...DEFAULT_SETTINGS, feePct: 13.7, commissionPct: 2.5 },
    };
    assert.equal(
      financialCeilingFor(
        sale,
        { ...DEFAULT_SETTINGS, ...m.costs, minRoi: m.minRoi },
        m.minProfit,
      ),
      purchasePolicy(p, DEFAULT_SETTINGS, m).financialCeiling,
    );
  }
});
async function outbox() {
  const f = database();
  await ensureUser(f.db, "u1");
  const listing = {
    ...fixture().listing,
    publishedAt: new Date().toISOString(),
    publicationStatus: "valid" as const,
    availability: "active" as const,
  };
  await listingStatement(f.db, "u1", listing).run();
  const a = {
    id: "alert",
    listingId: listing.id,
    title: "Teste isolado",
    demo: false,
  } as Alert;
  f.sql
    .prepare(
      "INSERT INTO alerts(id,user_id,listing_id,event_key,created_at,data) VALUES ('alert','u1',?,'event',?,?)",
    )
    .run(a.listingId, new Date().toISOString(), JSON.stringify(a));
  f.sql
    .prepare(
      "INSERT INTO notification_outbox(id,user_id,alert_id,channel,status,available_at) VALUES ('out','u1','alert','telegram','pending','2000-01-01')",
    )
    .run();
  return f;
}
test("F11: falha de transporte vira incerta; recusa comprovada tem tentativas limitadas", async () => {
  const f = await outbox();
  let calls = 0;
  assert.equal(
    (
      await deliverOne(f.db, "u1", {
        async send() {
          calls++;
          throw new Error("timeout after possibly sent");
        },
      })
    ).status,
    "uncertain",
  );
  await deliverOne(f.db, "u1", {
    async send() {
      calls++;
    },
  });
  assert.equal(calls, 1);
  f.sql.close();
  const g = await outbox();
  for (let i = 0; i < 3; i++) {
    g.sql
      .prepare("UPDATE notification_outbox SET available_at='2000-01-01'")
      .run();
    const r = await deliverOne(g.db, "u1", {
      async send() {
        throw new DeliveryRejected(true, 10);
      },
    });
    assert.equal(r.status, i < 2 ? "retry_scheduled" : "failed");
  }
  assert.equal(
    g.sql.prepare("SELECT attempts FROM notification_outbox").get()!.attempts,
    3,
  );
  g.sql.close();
});
test("F11: perda de posse depois do envio não é reportada como sent", async () => {
  const f = await outbox();
  const r = await deliverOne(f.db, "u1", {
    async send() {
      f.sql
        .prepare(
          "UPDATE notification_outbox SET lease_token='different',status='uncertain'",
        )
        .run();
    },
  });
  assert.equal(r.status, "uncertain");
  f.sql.close();
});
const provider: MarketplaceProvider = {
  id: "brightdata",
  capabilities: {
    discovery: true,
    publicationTime: true,
    locationFilter: false,
    availability: false,
    images: true,
  },
  healthCheck: async () => ({ ok: true, message: "TEST FIXTURE ONLY" }),
  search: async () => ({ items: [], complete: true, warnings: [] }),
  getListing: async () => null,
  getImages: () => [],
  getSellerInfo: () => ({ id: null }),
  getPublicationTime: () => ({ value: null, confidence: 0 }),
};
test("F09: agendador serve duas contas sem interface e respeita desligamento de coleta", async () => {
  const { db, sql } = database();
  for (const user of ["u1", "u2"]) {
    await ensureUser(db, user);
    await saveMonitor(db, user, {
      name: "Busca isolada",
      query: "iPhone 15",
      maxPrice: 3000,
      intervalSeconds: 300,
    });
  }
  let calls = 0;
  const factory = () => ({
    ...provider,
    search: async () => {
      calls++;
      return { items: [], complete: true, warnings: [] };
    },
  });
  const settings = {
    PILOT_MODE: "false",
    COLLECTION_ENABLED: "true",
    MAX_DAILY_PROVIDER_TRIGGERS: "5",
  };
  const r = await runSchedulerTick(
    db,
    factory,
    pilotConfig(settings),
    settings,
  );
  assert.equal(r.accounts, 2);
  assert.equal(calls, 2);
  const owners = sql
    .prepare("SELECT DISTINCT user_id FROM provider_runs ORDER BY user_id")
    .all()
    .map((x) => x.user_id);
  assert.deepEqual(owners, ["u1", "u2"]);
  // New process state uses the same persisted DB, not React or an open browser.
  sql.prepare("UPDATE monitor_scopes SET next_run_at='2000-01-01'").run();
  await enqueue(db, "u1", true);
  const count = calls;
  await runSchedulerTick(db, factory, pilotConfig(settings), {
    ...settings,
    COLLECTION_ENABLED: "false",
  });
  assert.equal(calls, count);
  assert.equal(
    sql
      .prepare("SELECT COUNT(*) n FROM provider_runs WHERE status='running'")
      .get()!.n,
    0,
  );
  assert.equal(
    sql
      .prepare("SELECT lease_token FROM worker_heartbeats WHERE id='scheduler'")
      .get()!.lease_token,
    null,
  );
  sql.close();
});
test("Migration 0005 preserva linhas e ownership existentes e mantém foreign keys válidas", () => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql") && !f.startsWith("0005"))
    .sort())
    db.exec(readFileSync("drizzle/" + f, "utf8"));
  db.prepare("INSERT INTO users VALUES ('existing','2026-01-01',?,0)").run(
    JSON.stringify(DEFAULT_SETTINGS),
  );
  db.prepare(
    "INSERT INTO monitors(id,user_id,config,active,created_at,financials) VALUES ('old','existing','{}',0,'2026-01-01','{\"version\":1}')",
  ).run();
  const before = db.prepare("SELECT * FROM monitors").all();
  db.exec(readFileSync("drizzle/0005_saas_foundation.sql", "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM monitors").all(), before);
  assert.equal(
    db.prepare("SELECT user_id FROM accounts").get()!.user_id,
    "existing",
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("Migration 0005 preserva sete buscas ativas de uma conta legada sem elevar cota paga", () => {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("drizzle")
    .filter((file) => file.endsWith(".sql") && !file.startsWith("0005"))
    .sort()) {
    db.exec(readFileSync("drizzle/" + file, "utf8"));
  }
  db.prepare("INSERT INTO users VALUES ('legacy-owner','2026-01-01',?,0)").run(
    JSON.stringify(DEFAULT_SETTINGS),
  );
  const insert = db.prepare(
    "INSERT INTO monitors(id,user_id,config,active,created_at,financials) VALUES (?,'legacy-owner','{}',1,'2026-01-01','{\"version\":1}')",
  );
  for (let index = 0; index < 7; index++) insert.run("kept-" + index);
  const before = db.prepare("SELECT * FROM monitors ORDER BY id").all();
  db.exec(readFileSync("drizzle/0005_saas_foundation.sql", "utf8"));
  assert.deepEqual(
    db.prepare("SELECT * FROM monitors ORDER BY id").all(),
    before,
  );
  const plan = db
    .prepare(
      "SELECT p.* FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE a.user_id='legacy-owner'",
    )
    .get()!;
  assert.equal(plan.id, "legacy");
  assert.equal(plan.max_active, 7);
  assert.equal(plan.daily_triggers, 5);
  assert.equal(plan.telegram, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
