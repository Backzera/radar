import { z } from "zod";
import { all, type Database } from "./store";
import { HttpError } from "./security";
export const dealStages = {
  interested: "Interessado",
  negotiating: "Em negociação",
  bought: "Comprado",
  for_sale: "À venda",
  sold: "Vendido",
  passed: "Não vou comprar",
};
export const dealInput = z
  .object({
    stage: z.enum(["interested", "negotiating", "for_sale", "passed"]),
    note: z.string().max(2000).default(""),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .strict();
export async function saveDeal(
  db: Database,
  userId: string,
  id: string,
  input: unknown,
) {
  const d = dealInput.parse(input),
    now = new Date().toISOString();
  const l = await db
    .prepare("SELECT id FROM listings WHERE id=? AND user_id=? AND demo=0")
    .bind(id, userId)
    .first();
  if (!l) throw new Error("NOT_FOUND");
  const purchase = await db
    .prepare("SELECT data FROM purchases WHERE user_id=? AND listing_id=?")
    .bind(userId, id)
    .first<{ data: string }>();
  if (purchase && JSON.parse(purchase.data).soldAt)
    throw new HttpError(
      409,
      "A venda já está registrada. O histórico financeiro foi preservado.",
    );
  if (d.stage === "for_sale" && !purchase)
    throw new HttpError(
      422,
      "Registre o valor da compra nos detalhes antes de colocar à venda.",
    );
  if (purchase && !["for_sale"].includes(d.stage))
    throw new HttpError(
      409,
      "Este item já foi comprado. Use À venda ou registre a venda nos detalhes.",
    );
  const current = await db
    .prepare(
      "SELECT version FROM deal_pipeline WHERE user_id=? AND listing_id=?",
    )
    .bind(userId, id)
    .first<{ version: number }>();
  if (current && d.expectedVersion !== current.version)
    throw new HttpError(
      409,
      "Este negócio foi atualizado. Recarregue antes de salvar.",
    );
  const q = current
    ? db
        .prepare(
          "UPDATE deal_pipeline SET stage=?,note=?,version=version+1,updated_at=? WHERE user_id=? AND listing_id=? AND version=?",
        )
        .bind(d.stage, d.note, now, userId, id, current.version)
    : db
        .prepare(
          "INSERT OR IGNORE INTO deal_pipeline(user_id,listing_id,stage,note,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(userId, id, d.stage, d.note, now, now);
  const result = await q.run();
  if (!result.meta.changes)
    throw new HttpError(
      409,
      "Outra atualização foi salva. Recarregue os negócios.",
    );
  return { saved: true, version: (current?.version ?? 0) + 1 };
}
export async function dealFor(db: Database, userId: string, id: string) {
  return db
    .prepare(
      "SELECT stage,note,version,updated_at FROM deal_pipeline WHERE user_id=? AND listing_id=?",
    )
    .bind(userId, id)
    .first<{
      stage: keyof typeof dealStages;
      note: string;
      version: number;
      updated_at: string;
    }>();
}
export async function getDeals(
  db: Database,
  userId: string,
  page = 1,
  limit = 25,
  stage = "",
) {
  const rows = await all<{
    listing_id: string;
    stage: keyof typeof dealStages;
    note: string;
    version: number;
    updated_at: string;
    data: string;
    purchase: string | null;
  }>(
    db,
    `SELECT d.*,l.data,p.data AS purchase FROM deal_pipeline d JOIN listings l ON l.id=d.listing_id AND l.user_id=d.user_id LEFT JOIN purchases p ON p.listing_id=d.listing_id AND p.user_id=d.user_id WHERE d.user_id=? AND (?='' OR d.stage=?) ORDER BY d.updated_at DESC,d.listing_id LIMIT ? OFFSET ?`,
    userId,
    stage,
    stage,
    limit,
    (page - 1) * limit,
  );
  const total = await db
    .prepare(
      "SELECT COUNT(*) n FROM deal_pipeline WHERE user_id=? AND (?='' OR stage=?)",
    )
    .bind(userId, stage, stage)
    .first<{ n: number }>();
  const counts = await all<{ stage: string; n: number }>(
    db,
    "SELECT stage,COUNT(*) n FROM deal_pipeline WHERE user_id=? GROUP BY stage",
    userId,
  );
  return {
    items: rows.map((r) => {
      const l = JSON.parse(r.data);
      return {
        listingId: r.listing_id,
        title: l.title,
        price: l.price,
        stage: r.stage,
        note: r.note,
        version: r.version,
        updatedAt: r.updated_at,
        purchase: r.purchase ? JSON.parse(r.purchase) : null,
      };
    }),
    total: total?.n ?? 0,
    page,
    limit,
    counts,
  };
}
