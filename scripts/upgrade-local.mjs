/** Additive update of an existing local 2.0-dev database, with a verified backup. */
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { copyDatabase } from "./backup.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
function files(dir) {
  return !existsSync(dir)
    ? []
    : readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.isSymbolicLink())
        .flatMap((e) =>
          e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
        );
}
export async function upgradeLocal(root = process.cwd()) {
  const name = "0006_radar_experience.sql",
    migration = join(root, "drizzle", name);
  if (!existsSync(migration)) return { status: "no_update" };
  const path = join(root, ".wrangler/radar-migrations.json");
  const journal = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {};
  for (const [file, expected] of Object.entries(journal)) {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/i.test(file) || typeof expected !== "string")
      throw new Error(
        "Registro de migrations inválido; nenhum banco foi alterado.",
      );
    const original = join(root, "drizzle", file);
    if (!existsSync(original) || hash(readFileSync(original)) !== expected)
      throw new Error(
        "Migration previamente aplicada foi alterada: " +
          file +
          ". Restaure a source antes de iniciar.",
      );
  }
  const content = readFileSync(migration),
    digest = hash(content);
  if (journal[name] === digest) return { status: "current" };
  const matches = [];
  for (const f of files(join(root, ".wrangler/state")).filter((f) =>
    f.endsWith(".sqlite"),
  )) {
    let db;
    try {
      db = new DatabaseSync(f, { readOnly: true });
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((r) => r.name),
      );
      if (
        ["users", "monitors", "listings", "accounts", "feed_revisions"].every(
          (t) => tables.has(t),
        )
      )
        matches.push(f);
    } catch {
    } finally {
      db?.close();
    }
  }
  if (!matches.length) return { status: "not_initialized" };
  if (matches.length !== 1)
    throw new Error(
      "Mais de um banco local encontrado. Nenhum foi alterado. Use a instalação correspondente ou confira o banco antes de atualizar.",
    );
  const source = matches[0],
    backup = join(
      root,
      "backups",
      "radar-before-v2-" +
        Date.now() +
        "-" +
        randomUUID().slice(0, 8) +
        ".sqlite",
    );
  await copyDatabase(source, backup);
  const db = new DatabaseSync(source);
  try {
    db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;",
    );
    db.exec(content.toString("utf8"));
    if (
      db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("Verificação do banco falhou; atualização revertida.");
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    db.close();
  }
  // Migration is idempotent if a crash occurs between COMMIT and journal publication.
  journal[name] = digest;
  mkdirSync(join(root, ".wrangler"), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  writeFileSync(temp, JSON.stringify(journal, null, 2) + "\n", { flag: "wx" });
  renameSync(temp, path);
  console.info(
    "[Market Radar] Banco local atualizado; cópia de segurança em " + backup,
  );
  return { status: "upgraded", backup };
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    console.log(JSON.stringify(await upgradeLocal()));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
