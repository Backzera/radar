import { DEFAULT_SETTINGS, type Monitor } from "../core/types";
import { demoBaseline, demoNew, DEMO_PRODUCTS } from "./mock";
import { materialize, ingest } from "../server/ingestion";
import { batch, listingStatement, uid, type Database } from "../server/store";
export async function ensureUser(db: Database, userId: string) {
  await db
    .prepare(
      "INSERT OR IGNORE INTO users (id,created_at,settings,demo_seeded) VALUES (?,?,?,0)",
    )
    .bind(userId, new Date().toISOString(), JSON.stringify(DEFAULT_SETTINGS))
    .run();
}
export async function seedDemo(db: Database, userId: string) {
  await ensureUser(db, userId);
  const claim = await db
    .prepare(
      "UPDATE users SET demo_seeded = 2 WHERE id = ? AND demo_seeded = 0 RETURNING id",
    )
    .bind(userId)
    .first();
  if (!claim) return;
  const now = new Date(),
    createdAt = now.toISOString();
  try {
    const monitors: Monitor[] = DEMO_PRODUCTS.map((p, i) => ({
      id: `${userId}:demo-monitor-${i}`,
      name: p.title.replace(/ azul| prata| preto| branco/, ""),
      query: p.query,
      aliases: i === 1 ? ["ps5", "play 5", "playstation 5"] : [],
      negatives: ["somente caixa", "somente peças", "icloud"],
      minPrice: 0,
      maxPrice: Math.ceil(p.market * 1.15),
      city: "Curitiba",
      radiusKm: 30,
      latitude: null,
      longitude: null,
      condition: "any",
      active: true,
      mode: "automatic",
      manualPrice: null,
      strongPrice: null,
      ultraPrice: null,
      minRoi: 20,
      maxRisk: 35,
      minLiquidity: 0,
      minScore: 65,
      intervalSeconds: 120,
      provider: "demo",
      revision: 1,
    }));
    await batch(
      db,
      monitors.flatMap((m) => [
        db
          .prepare(
            "INSERT OR IGNORE INTO monitors (id,user_id,config,active,created_at) VALUES (?,?,?,?,?)",
          )
          .bind(m.id, userId, JSON.stringify(m), 1, createdAt),
        db
          .prepare(
            "INSERT OR IGNORE INTO monitor_scopes (id,user_id,monitor_id,provider,revision,baseline_complete,next_run_at,sequence) VALUES (?,?,?,?,?,1,?,1)",
          )
          .bind(
            `${m.id}:demo:1`,
            userId,
            m.id,
            "demo",
            1,
            new Date(now.getTime() + 120000).toISOString(),
          ),
      ]),
    );
    const historical = demoBaseline(now).map((r) => ({
      ...materialize(r, true, new Date(now.getTime() - 3600000)),
      id: `${userId}:${r.externalId}`,
    }));
    await batch(
      db,
      historical.map((l) => listingStatement(db, userId, l)),
    );
    await batch(
      db,
      historical.map((l) =>
        db
          .prepare(
            "INSERT INTO listing_snapshots (id,listing_id,user_id,price,availability,observed_at,hash,data) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            uid(),
            l.id,
            userId,
            l.price,
            l.availability,
            l.firstSeenAt,
            l.fingerprint,
            JSON.stringify({ provider: "demo", baseline: true }),
          ),
      ),
    );
    // Playback after the demo baseline. No notification is sent during initial load.
    for (let i = 0; i < monitors.length; i++)
      await ingest(
        db,
        userId,
        monitors[i],
        [demoNew(i, 1, now)],
        false,
        DEFAULT_SETTINGS,
        now,
        false,
      );
    const unknown = demoNew(0, 5, now),
      partial = demoNew(0, 3, now);
    const accessory = {
      ...demoNew(1, 7, now),
      externalId: "demo-accessory",
      url: "https://demo.invalid/marketplace/item/demo-accessory",
      title: "Controle PS5 DualSense para PS5 Slim Digital",
      price: 350,
    };
    await ingest(
      db,
      userId,
      monitors[0],
      [unknown, partial],
      false,
      DEFAULT_SETTINGS,
      now,
      false,
    );
    await ingest(
      db,
      userId,
      monitors[1],
      [accessory],
      false,
      DEFAULT_SETTINGS,
      now,
      false,
    );
    const dropped = {
      ...demoNew(1, 8, now),
      externalId: "demo-price-drop",
      url: "https://demo.invalid/marketplace/item/demo-price-drop",
      publishedAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
      price: 2800,
    };
    await ingest(
      db,
      userId,
      monitors[1],
      [dropped],
      true,
      DEFAULT_SETTINGS,
      new Date(now.getTime() - 3600000),
      false,
    );
    await ingest(
      db,
      userId,
      monitors[1],
      [{ ...dropped, price: 1900 }],
      false,
      DEFAULT_SETTINGS,
      now,
      false,
    );
    await db
      .prepare("UPDATE users SET demo_seeded = 1 WHERE id = ?")
      .bind(userId)
      .run();
  } catch (error) {
    await db
      .prepare("UPDATE users SET demo_seeded = 0 WHERE id = ?")
      .bind(userId)
      .run();
    throw error;
  }
}
