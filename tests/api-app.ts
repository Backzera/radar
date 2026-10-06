/** The real API handler over an in-memory database, for tests that go through HTTP. */
import assert from "node:assert/strict";
import { createHandler } from "../server/http";
import type { MediaStore } from "../server/inventory";
import { addDays, todayIn } from "../core/brick";
import { database } from "./fixtures";

const ORIGIN = "http://localhost";
// API bodies are checked field by field in the tests; loose typing keeps that readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
type ApiResponse = Omit<Response, "json"> & { json(): Promise<Json> };
const CONFIG = {
  AUTH_MODE: "password",
  ALLOW_LOCAL_DEV_AUTH: "true",
  RADAR_ADMIN_EMAILS: "dono@example.test",
};
export const today = todayIn();
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
export const item = (overrides: Record<string, unknown> = {}) => ({
  name: "iPhone 13 128GB",
  category: "phones",
  brand: "Apple",
  model: "iPhone 13",
  condition: "used",
  purchasePriceCents: 150000,
  purchasedAt: addDays(today, -10),
  purchaseChannel: "facebook",
  askingPriceCents: 210000,
  ...overrides,
});
export const query = (values: Record<string, string>) => new URLSearchParams(values).toString();

export function app() {
  const { db } = database();
  const objects = new Map<string, Uint8Array>();
  const media: MediaStore = {
    async put(key, value) {
      objects.set(key, new Uint8Array(value));
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { body: new Response(o as unknown as BodyInit).body! } : null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
  };
  const handler = createHandler(db, CONFIG, { development: true, media });
  const call = async (
    path: string,
    init: { method?: string; body?: unknown; cookie?: string; type?: string; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = { origin: ORIGIN, ...init.headers };
    if (init.cookie) headers.cookie = init.cookie;
    if (init.body !== undefined) headers["content-type"] = init.type ?? "application/json";
    const response = await handler(
      new Request(`${ORIGIN}/api/v1/${path}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers,
        body:
          init.body === undefined
            ? undefined
            : init.body instanceof Uint8Array
              ? (init.body as unknown as BodyInit)
              : JSON.stringify(init.body),
      }),
    );
    return response as unknown as ApiResponse;
  };
  const signup = async (email: string, name: string) => {
    const r = await call("auth/signup", {
      body: { name, email, password: "senha-forte-123", acceptTerms: true },
    });
    assert.equal(r.status, 201);
    return r.headers.get("set-cookie")!.split(";")[0];
  };
  const userId = async (owner: string, email: string) => {
    const { users } = await (await call("admin/users", { cookie: owner })).json();
    return users.find((u: Json) => u.email === email).id as string;
  };
  return { db, call, signup, userId };
}
