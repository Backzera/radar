import { DatabaseSync, backup } from "node:sqlite";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  linkSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
export async function copyDatabase(
  source,
  destination,
  { restore = false } = {},
) {
  source = resolve(source);
  destination = resolve(destination);
  if (
    source === destination ||
    existsSync(destination) ||
    existsSync(destination + ".manifest.json")
  )
    throw new Error(
      "Destino deve ser novo; nenhum arquivo existente será sobrescrito.",
    );
  if (!existsSync(source)) throw new Error("Banco de origem não encontrado.");
  if (restore) {
    const manifest = JSON.parse(
      readFileSync(source + ".manifest.json", "utf8"),
    );
    if (manifest.sha256 !== digest(source))
      throw new Error("Hash do backup não confere.");
  }
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = destination + "." + randomUUID() + ".tmp";
  let db,
    verified,
    published = false;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("Origem não passou na verificação de integridade.");
    await backup(db, temporary);
    db.close();
    db = null;
    chmodSync(temporary, 0o600);
    verified = new DatabaseSync(temporary, { readOnly: true });
    if (
      verified.prepare("PRAGMA integrity_check").get().integrity_check !== "ok"
    )
      throw new Error("Cópia não passou na verificação de integridade.");
    const foreignKeyIssues = verified
      .prepare("PRAGMA foreign_key_check")
      .all().length;
    if (foreignKeyIssues)
      throw new Error(
        "Cópia possui violações de foreign key; não foi publicada.",
      );
    const tables = verified
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    verified.close();
    verified = null;
    const sha256 = digest(temporary);
    // Hard link fails atomically when a target already exists. Never overwrite a live DB.
    linkSync(temporary, destination);
    published = true;
    writeFileSync(
      destination + ".manifest.json",
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          sha256,
          tables,
          integrity: "ok",
          foreignKeyIssues,
          restored: restore,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return { destination, sha256, integrity: "ok" };
  } catch (error) {
    if (published) {
      try {
        unlinkSync(destination);
      } catch {}
    }
    throw error;
  } finally {
    db?.close();
    verified?.close();
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [operation, source, destination, ...extra] = process.argv.slice(2);
  if (
    !["create", "restore"].includes(operation) ||
    !source ||
    !destination ||
    extra.length
  )
    throw new Error(
      "Uso: node scripts/backup.mjs create|restore ORIGEM DESTINO_NOVO",
    );
  console.log(
    JSON.stringify(
      await copyDatabase(source, destination, {
        restore: operation === "restore",
      }),
    ),
  );
}
