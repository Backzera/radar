/**
 * Path prefix of the site, e.g. "/brique" on dz7.online/brique; empty at the
 * domain root. Injected at build time by vite.config.ts (BASE_PATH).
 */
declare const __BASE_PATH__: string | undefined;
export const BASE = typeof __BASE_PATH__ === "string" ? __BASE_PATH__ : "";
export const withBase = (path: string) => `${BASE}${path}`;
