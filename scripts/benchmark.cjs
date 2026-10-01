/* eslint-disable @typescript-eslint/no-require-imports -- Reads compiled CommonJS test modules only. */
const { performance } = require("node:perf_hooks"),
  path = require("node:path");
const root = process.cwd(),
  mode = process.argv[2],
  n = Number(process.argv[3]),
  pattern = process.argv[4] ?? "same";
if (
  !["before", "after"].includes(mode) ||
  !Number.isInteger(n) ||
  n < 1 ||
  n > 5000 ||
  !["same", "mixed", "unique"].includes(pattern)
)
  throw new Error(
    "Uso: node scripts/benchmark.cjs before|after 1..5000 [same|mixed|unique]",
  );
const { database, fixture } = require(
    path.join(root, ".test-build/tests/fixtures.js"),
  ),
  { listingStatement } = require(
    path.join(root, ".test-build/server/store.js"),
  ),
  { saveMonitor, state } = require(
    path.join(root, ".test-build/server/service.js"),
  );
(async () => {
  const { db, sql, createUser } = database();
  await createUser();
  await saveMonitor(db, "u1", {
    name: "Benchmark",
    query: "iPhone 15",
    city: "",
    maxPrice: 3000,
    ...(mode === "after" ? { intent: "personal" } : {}),
  });
  const { listing } = fixture(),
    now = new Date().toISOString();
  for (let i = 0; i < n; i++) {
    const l = {
      ...listing,
      id: "bench-" + i,
      externalId: "bench-" + i,
      sellerId: "seller-" + i,
      fingerprint: "fp-" + i,
      url: `https://www.facebook.com/marketplace/item/${i + 1000}/`,
      title:
        pattern === "mixed"
          ? `iPhone ${11 + (i % 5)} ${[64, 128, 256, 512][Math.floor(i / 5) % 4]} GB usado`
          : "iPhone 15 128 GB usado",
      price: pattern === "unique" ? 1000 + i * 0.17 : 2100 + (i % 20) * 5,
      baseline: true,
      lastSeenAt: now,
      firstSeenAt: now,
      publishedAt: now,
      publicationStatus: "valid",
    };
    l.product = require(
      path.join(root, ".test-build/core/normalize.js"),
    ).normalize(l);
    await listingStatement(db, "u1", l).run();
  }
  let queries = 0,
    dbMs = 0;
  const wrapped = {
    ...db,
    prepare(q) {
      const s = db.prepare(q),
        proxy = {
          bind(...args) {
            s.bind(...args);
            return proxy;
          },
        };
      for (const method of ["run", "all", "first"])
        proxy[method] = async (...args) => {
          const start = performance.now();
          try {
            return await s[method](...args);
          } finally {
            dbMs += performance.now() - start;
            queries++;
          }
        };
      return proxy;
    },
  };
  const start = performance.now();
  const data =
    mode === "after"
      ? await require(path.join(root, ".test-build/server/feed.js")).getFeed(
          wrapped,
          "u1",
          { limit: 50 },
        )
      : await state(wrapped, "u1");
  const computeMs = performance.now() - start;
  const serializationStart = performance.now(),
    body = JSON.stringify(data),
    serializationMs = performance.now() - serializationStart;
  const coldQueries = queries,
    coldDbMs = dbMs;
  let warmMs = null;
  if (mode === "after") {
    const w = performance.now();
    await require(path.join(root, ".test-build/server/feed.js")).getFeed(
      wrapped,
      "u1",
      { limit: 50 },
    );
    warmMs = performance.now() - w;
  }
  const result = {
    mode,
    n,
    pattern,
    items: mode === "after" ? data.items.length : data.opportunities.length,
    bytes: Buffer.byteLength(body),
    comparables: (mode === "after" ? data.items : data.opportunities).reduce(
      (s, o) => s + o.analysis.pricing.comparables.length,
      0,
    ),
    queries: coldQueries,
    dbMs: Math.round(coldDbMs),
    warmQueries: queries - coldQueries,
    warmDbMs: Math.round(dbMs - coldDbMs),
    computeMs: Math.round(computeMs),
    serializationMs: +serializationMs.toFixed(2),
    warmMs: warmMs === null ? null : Math.round(warmMs),
    node: process.version,
    platform: process.platform,
  };
  console.log(JSON.stringify(result));
  sql.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
