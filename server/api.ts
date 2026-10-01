import { env } from "cloudflare:workers";
import { createHandler } from "./http";
export const runtimeEnv = () =>
  env as unknown as Record<string, string | undefined> & { DB: D1Database };
export async function handle(request: Request) {
  const e = runtimeEnv();
  return createHandler(e.DB, e, {
    development: process.env.NODE_ENV === "development",
  })(request);
}
