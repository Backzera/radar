import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
if (!existsSync("dist/server/wrangler.json"))
  throw new Error("Execute npm run build antes de aplicar migrations locais.");
mkdirSync(".wrangler", { recursive: true });
const journalPath = ".wrangler/radar-migrations.json";
const journal = existsSync(journalPath)
  ? JSON.parse(readFileSync(journalPath, "utf8"))
  : {};
for (const file of readdirSync("drizzle")
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  const hash = createHash("sha256")
    .update(readFileSync(`drizzle/${file}`))
    .digest("hex");
  if (journal[file]) {
    if (journal[file] !== hash)
      throw new Error(`Migration já aplicada foi alterada: ${file}`);
    continue;
  }
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/sites-env.mjs",
      "./node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "dist/server/wrangler.json",
      "--persist-to",
      ".wrangler/state",
      "--file",
      `drizzle/${file}`,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  journal[file] = hash;
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
}
console.log("Migrations locais atualizadas. Nenhum banco remoto foi alterado.");
