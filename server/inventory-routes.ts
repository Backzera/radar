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
    if (path === "inventory/export.csv") return exportCsv(db, userId);
    if (path === "brick/preferences")
      return json(await getPreferences(db, userId));
    const item = path.match(/^inventory\/([^/]+)$/);
    if (item) return json(await getItem(db, userId, id(item[1])));
    return null;
  }
  if (method === "POST" && PHOTO_UPLOAD.test(path))
    return json(
      await addPhoto(db, userId, id(path.split("/")[1]), request, media),
      201,
    );
  if (
    !path.startsWith("inventory") &&
    path !== "brick/preferences"
  )
    return null;
  const body = await readBoundedJson(request);
  if (method === "POST") {
    if (path === "inventory")
      return json(await createItem(db, userId, body), 201);
    if (path === "brick/preferences")
      return json(await savePreferences(db, userId, body));
    let m = path.match(/^inventory\/([^/]+)$/);
    if (m) return json(await updateItem(db, userId, id(m[1]), body));
    m = path.match(/^inventory\/([^/]+)\/(status|sell|unsell|costs)$/);
    if (m) {
      const itemId = id(m[1]);
      if (m[2] === "status") return json(await setStatus(db, userId, itemId, body));
      if (m[2] === "sell") return json(await sellItem(db, userId, itemId, body));
      if (m[2] === "unsell") return json(await unsellItem(db, userId, itemId));
      return json(await addCost(db, userId, itemId, body), 201);
    }
    m = path.match(/^inventory\/([^/]+)\/photos\/([^/]+)\/cover$/);
    if (m) return json(await coverPhoto(db, userId, id(m[1]), id(m[2])));
  }
  if (method === "DELETE") {
    let m = path.match(/^inventory\/([^/]+)$/);
    if (m) return json(await deleteItem(db, userId, id(m[1]), media));
    m = path.match(/^inventory\/([^/]+)\/costs\/([^/]+)$/);
    if (m) return json(await deleteCost(db, userId, id(m[1]), id(m[2])));
    m = path.match(/^inventory\/([^/]+)\/photos\/([^/]+)$/);
    if (m)
      return json(await deletePhoto(db, userId, id(m[1]), id(m[2]), media));
  }
  // The body is already consumed: answer here instead of falling through.
  throw new HttpError(404, "Rota não encontrada.");
}
