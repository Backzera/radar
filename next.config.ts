import type { NextConfig } from "next";

// BASE_PATH serves the site under a prefix (dz7.online/brique → "/brique").
// The VPS build (RADAR_BUILD_TARGET=node) emits a standalone Node server.
const basePath = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");
const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  ...(process.env.RADAR_BUILD_TARGET === "node"
    ? { output: "standalone" as const }
    : {}),
};

export default nextConfig;
