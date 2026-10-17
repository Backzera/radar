// Explicitly isolated integration harness. Never use as the production server.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url),
  { database, fixture } = require("../../.test-build/tests/fixtures.js"),
  { createHandler } = require("../../.test-build/server/http.js"),
  { ensureUser } = require("../../.test-build/server/seed.js"),
  { saveMonitor } = require("../../.test-build/server/service.js"),
  { listingStatement } = require("../../.test-build/server/store.js"),
  { normalize } = require("../../.test-build/core/normalize.js");
const { db, sql } = database();
await ensureUser(db, "local-radar");
if (process.argv.includes("--seed")) {
  await saveMonitor(db, "local-radar", {
    name: "iPhone no orçamento",
    product: "iPhone 15 128 GB",
    query: "iPhone 15",
    intent: "personal",
    city: "Curitiba",
    maxPrice: 2800,
    intervalSeconds: 300,
    negativeMode: "contextual",
  });
  const { listing } = fixture(),
    now = new Date().toISOString();
  for (let i = 0; i < 30; i++) {
    const raw = {
      ...listing,
      id: "synthetic-" + i,
      externalId: String(900000 + i),
      title: `iPhone 15 128 GB usado ${i + 1}`,
      description:
        "Aparelho usado, acompanha capinha. Sem bloqueio de iCloud. Exemplo sintético exclusivo do teste.",
      images: [],
      sellerId: "synthetic-seller-" + i,
      fingerprint: "synthetic-fp-" + i,
      url: `https://www.facebook.com/marketplace/item/${900000 + i}/`,
      originalUrl: `https://www.facebook.com/marketplace/item/${900000 + i}/`,
      price: 2300 + i * 10,
      baseline: true,
      publishedAt: now,
      publicationStatus: "valid",
      lastSeenAt: now,
      firstSeenAt: now,
    };
    await listingStatement(db, "local-radar", {
      ...raw,
      product: normalize(raw),
    }).run();
  }
}
const config = {
  ALLOW_LOCAL_DEV_AUTH: "true",
  AUTH_MODE: "disabled",
  COLLECTION_ENABLED: "false",
  PILOT_MODE: "true",
  RADAR_ADMIN_IDS: process.argv.includes("--admin") ? "local-radar" : "",
};
const handle = createHandler(db, config, {
  development: true,
  provider: () => {
    throw new Error("External provider prohibited in browser harness");
  },
});
const port = Number(process.env.TEST_PORT ?? 4173),
  host = "127.0.0.1";
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      const controller = new AbortController();
      res.on("close", () => controller.abort());
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 65536) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(c);
      }
      const r = new Request(`http://${host}:${port}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: !["GET", "HEAD"].includes(req.method)
          ? Buffer.concat(chunks)
          : undefined,
        signal: controller.signal,
      });
      const response = await handle(r);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (!res.destroyed) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      }
      res.end();
      return;
    }
    if (req.url === "/app.js") {
      res
        .writeHead(200, { "content-type": "text/javascript" })
        .end(readFileSync(".browser-build/app.js"));
      return;
    }
    if (req.url === "/styles.css") {
      res
        .writeHead(200, { "content-type": "text/css" })
        .end("body{margin:0}" + readFileSync("app/saas.css", "utf8"));
      return;
    }
    if (req.url === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(
        '<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ágio | Teste isolado</title><link rel="stylesheet" href="/styles.css"></head><body><div style="padding:6px 12px;background:#fff2ce;color:#493916;font:12px system-ui">TESTE ISOLADO: dados sintéticos, sem coleta, sem credenciais reais. Bundle de integração, não build de produção.</div><div id="root"></div><script src="/app.js"></script></body></html>',
      );
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Browser harness failed");
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.listen(port, host, () =>
  console.log(`BROWSER_HARNESS http://${host}:${port}`),
);
function stop() {
  server.closeAllConnections();
  server.close(() => {
    sql.close();
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
