import { DEFAULT_SETTINGS } from "../core/types";
import type { Database } from "./store";
export async function ensureUser(db: Database, userId: string) {
  await db
    .prepare(
      "INSERT OR IGNORE INTO users (id,created_at,settings,demo_seeded) VALUES (?,?,?,0)",
    )
    .bind(userId, new Date().toISOString(), JSON.stringify(DEFAULT_SETTINGS))
    .run();
  await db
    .prepare("INSERT OR IGNORE INTO accounts(user_id,created_at) VALUES (?,?)")
    .bind(userId, new Date().toISOString())
    .run();
}
