import { HttpError, readBoundedJson } from "./security";
import { json } from "./respond";
import type { Database } from "./store";
import {
  addCost,
  addPhoto,
  coverPhoto,
  createItem,
  deleteCost,
  deleteItem,
  deletePhoto,
  exportCsv,
  getItem,
  getPreferences,
  inventorySummary,
  listItems,
  photoResponse,
  savePreferences,
  sellItem,
  setStatus,
  unsellItem,
  updateItem,
  type MediaStore,
} from "./inventory";
import { actorOf, itemActivity, recordActivity, type ItemChange } from "./activity";
import { formatCents } from "../core/brick";

/** Paths that take an image body instead of JSON. */
export const PHOTO_UPLOAD = /^inventory\/[^/]+\/photos$/;

/** Inventory, photos and brick preferences. Returns null for any other path. */
export async function handleInventoryRoute(
  db: Database,
  userId: string,
  request: Request,
  url: URL,
  path: string,
  media?: MediaStore,
): Promise<Response | null> {
  const method = request.method;
  const id = (segment: string) => decodeURIComponent(segment);
  const actor = actorOf(request, userId);
  // Runs one change to an item and records it, from the item's state before and after.
  const tracked = async (
    change: ItemChange,
    itemId: string | null,
    run: () => Promise<Awaited<ReturnType<typeof getItem>> | null>,
    status = 200,
  ) => {
    const before = itemId ? await getItem(db, userId, itemId).catch(() => null) : null;
    const after = await run();
    await recordActivity(db, actor, itemActivity(userId, change, before, after));
    return json(after ?? { deleted: true }, status);
  };
  if (method === "GET") {
    const photo = path.match(/^media\/([^/]+)$/);
    if (photo) return photoResponse(db, userId, id(photo[1]), media);
    if (path === "inventory")
      return json(
        await listItems(db, userId, Object.fromEntries(url.searchParams)),
      );
    if (path === "inventory/summary")
      return json(
        await inventorySummary(db, userId, url.searchParams.get("period")),
      );
    if (path === "inventory/export.csv") {
      const response = await exportCsv(db, userId);
      await recordActivity(db, actor, {
        userId,
        action: "export_inventory",
        entity: "export",
        summary: "Exportou o estoque em planilha",
      });
      return response;
    }
    if (path === "brick/preferences")
      return json(await getPreferences(db, userId));
    const item = path.match(/^inventory\/([^/]+)$/);
    if (item) return json(await getItem(db, userId, id(item[1])));
    return null;
  }
  if (method === "POST" && PHOTO_UPLOAD.test(path)) {
    const itemId = id(path.split("/")[1]);
    return tracked(
      "photo_add",
      null,
      () => addPhoto(db, userId, itemId, request, media),
      201,
    );
  }
  if (
    !path.startsWith("inventory") &&
    path !== "brick/preferences"
  )
    return null;
  const body = await readBoundedJson(request);
  if (method === "POST") {
    if (path === "inventory")
      return tracked("create", null, () => createItem(db, userId, body), 201);
    if (path === "brick/preferences") {
      const saved = await savePreferences(db, userId, body);
      await recordActivity(db, actor, {
        userId,
        action: "preferences_updated",
        entity: "account",
        entityId: userId,
        summary: `Atualizou as preferências: meta mensal ${saved.monthlyGoalCents ? formatCents(saved.monthlyGoalCents) : "sem meta"}; parado após ${saved.staleAfterDays} dias`,
        details: { monthlyGoalCents: saved.monthlyGoalCents, staleAfterDays: saved.staleAfterDays },
      });
      return json(saved);
    }
    let m = path.match(/^inventory\/([^/]+)$/);
    if (m) {
      const itemId = id(m[1]);
      return tracked("update", itemId, () => updateItem(db, userId, itemId, body));
    }
    m = path.match(/^inventory\/([^/]+)\/(status|sell|unsell|costs)$/);
    if (m) {
      const itemId = id(m[1]);
      if (m[2] === "status")
        return tracked("status", itemId, () => setStatus(db, userId, itemId, body));
      if (m[2] === "sell")
        return tracked("sell", itemId, () => sellItem(db, userId, itemId, body));
      if (m[2] === "unsell")
        return tracked("unsell", itemId, () => unsellItem(db, userId, itemId));
      return tracked("cost_add", itemId, () => addCost(db, userId, itemId, body), 201);
    }
    m = path.match(/^inventory\/([^/]+)\/photos\/([^/]+)\/cover$/);
    if (m) {
      const [itemId, photoId] = [id(m[1]), id(m[2])];
      return tracked("photo_cover", null, () => coverPhoto(db, userId, itemId, photoId));
    }
  }
  if (method === "DELETE") {
    let m = path.match(/^inventory\/([^/]+)$/);
    if (m) {
      const itemId = id(m[1]);
      return tracked("delete", itemId, async () => {
        await deleteItem(db, userId, itemId, media);
        return null;
      });
    }
    m = path.match(/^inventory\/([^/]+)\/costs\/([^/]+)$/);
    if (m) {
      const [itemId, costId] = [id(m[1]), id(m[2])];
      return tracked("cost_delete", itemId, () => deleteCost(db, userId, itemId, costId));
    }
    m = path.match(/^inventory\/([^/]+)\/photos\/([^/]+)$/);
    if (m) {
      const [itemId, photoId] = [id(m[1]), id(m[2])];
      return tracked("photo_delete", null, () => deletePhoto(db, userId, itemId, photoId, media));
    }
  }
  // The body is already consumed: answer here instead of falling through.
  throw new HttpError(404, "Rota não encontrada.");
}
