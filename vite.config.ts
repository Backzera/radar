import vinext from "vinext";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const productionTarget = process.env.RADAR_BUILD_TARGET === "production";
// Self-hosted build (VPS): plain Node server, SQLite file and photo folder
// instead of Workers, D1 and R2. See scripts/build-vps.mjs.
const nodeTarget = process.env.RADAR_BUILD_TARGET === "node";
const basePath = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "vinext/server/fetch-handler",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  const define = { __BASE_PATH__: JSON.stringify(basePath) };
  if (nodeTarget)
    return {
      define,
      resolve: {
        alias: {
          "cloudflare:workers": fileURLToPath(
            new URL("./server/node-runtime/env.ts", import.meta.url),
          ),
        },
      },
      plugins: [vinext()],
    };
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    define,
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : { host: "127.0.0.1", strictPort: true, allowedHosts: ["radar"] }),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      ...(productionTarget ? [] : [sites({ mockAuth: !managedLinux })]),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: productionTarget
          ? {
              ...JSON.parse(readFileSync("wrangler.production.json", "utf8")),
              main: "vinext/server/fetch-handler",
            }
          : localBindingConfig,
      }),
    ],
  };
});
