import { z } from "zod";
import { financialStorage } from "../core/purchase-policy";
import type { Monitor } from "../core/types";
import { getAccount, recordEvent } from "./accounts";
import { getMonitors, type Database } from "./store";
import { saveMonitor } from "./service";
import { monitorSchema } from "./validation";
import { HttpError } from "./security";
async function hash(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function saveSearch(
  db: Database,
  userId: string,
  input: unknown,
  id?: string,
) {
  const envelope = z
    .object({
      requestKey: z.string().uuid().optional(),
      activate: z.boolean().default(false),
      expectedVersion: z.number().int().min(0).optional(),
      config: z.record(z.unknown()),
    })
    .strict()
    .parse(input);
  const account = await getAccount(db, userId);
  if (account.status !== "active")
    throw new HttpError(
      403,
      "Acesso cancelado. Contate a administração para reativar.",
    );
  if (id) {
    if (envelope.expectedVersion === undefined)
      throw new HttpError(409, "Recarregue a busca antes de editar.");
    const existing = (await getMonitors(db, userId)).find((m) => m.id === id);
    if (!existing) throw new Error("NOT_FOUND");
    const updated = await saveMonitor(
      db,
      userId,
      { ...envelope.config, expectedVersion: envelope.expectedVersion },
      id,
    );
    return { monitor: updated, replayed: false };
  }
  if (!envelope.requestKey)
    throw new HttpError(
      422,
      "Identificador de criação ausente. Reabra o formulário.",
    );
  const config = monitorSchema.parse(envelope.config);
  if (config.intervalSeconds < account.min_interval)
    throw new HttpError(
      422,
      `O intervalo mínimo deste acesso é ${account.min_interval} segundos.`,
    );
  const inputHash = await hash(
    JSON.stringify({ config, activate: envelope.activate }),
  );
  const read = () =>
    db
      .prepare(
        "SELECT input_hash,monitor_id FROM monitor_commands WHERE user_id=? AND request_key=?",
      )
      .bind(userId, envelope.requestKey!)
      .first<{ input_hash: string; monitor_id: string }>();
  const result = async () => {
    const command = await read();
    if (!command) return null;
    if (command.input_hash !== inputHash)
      throw new HttpError(
        409,
        "Esta criação já foi usada com outros critérios. Reabra o formulário.",
      );
    const monitor = (await getMonitors(db, userId)).find(
      (m) => m.id === command.monitor_id,
    );
    if (!monitor) throw new Error("NOT_FOUND");
    return { monitor, replayed: true };
  };
  const previous = await result();
  if (previous) return previous;
  const monitor: Monitor = {
    ...config,
    id:
      "search-" +
      (await hash(userId + "\0" + envelope.requestKey)).slice(0, 32),
    version: 1,
    revision: 1,
  };
  try {
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO monitors(id,user_id,config,active,created_at,financials) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          monitor.id,
          userId,
          JSON.stringify(monitor),
          Number(monitor.active),
          new Date().toISOString(),
          financialStorage(monitor),
        ),
      ...(envelope.activate && monitor.active
        ? [
            db
              .prepare(
                "INSERT OR IGNORE INTO radar_activations(id,user_id,monitor_id,revision,created_at,updated_at) VALUES (?,?,?,?,?,?)",
              )
              .bind(
                monitor.id + ":" + monitor.revision,
                userId,
                monitor.id,
                monitor.revision,
                new Date().toISOString(),
                new Date().toISOString(),
              ),
          ]
        : []),
      db
        .prepare(
          "INSERT OR IGNORE INTO monitor_commands(user_id,request_key,input_hash,monitor_id) VALUES (?,?,?,?)",
        )
        .bind(userId, envelope.requestKey, inputHash, monitor.id),
    ]);
  } catch (error) {
    const replay = await result();
    if (replay) return replay;
    throw error;
  }
  const verified = await result();
  if (!verified) throw new Error("SEARCH_COMMIT_FAILED");
  await recordEvent(db, userId, "search_saved", monitor.id);
  return { ...verified, replayed: false };
}
export const draftSchema = z
  .object({
    step: z.number().int().min(0).max(3),
    requestKey: z.string().uuid().optional(),
    values: z.record(z.unknown()),
  })
  .strict();
export async function saveDraft(db: Database, userId: string, input: unknown) {
  const data = draftSchema.parse(input);
  await db
    .prepare(
      "INSERT INTO search_drafts VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
    )
    .bind(userId, JSON.stringify(data), new Date().toISOString())
    .run();
  return data;
}
