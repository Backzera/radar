import { env } from "cloudflare:workers";
import { createHandler } from "./http";
import type { MediaStore } from "./inventory";
export const runtimeEnv = () =>
  env as unknown as Record<string, string | undefined> & {
    DB: D1Database;
    MEDIA?: R2Bucket;
  };
export async function handle(request: Request) {
  const e = runtimeEnv();
  return createHandler(e.DB, e, {
    development: process.env.NODE_ENV === "development",
    media: e.MEDIA as unknown as MediaStore | undefined,
  })(request);
}
