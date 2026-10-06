/**
 * Cópia consistente do banco (pode rodar com o app no ar) em data\backups.
 * Usado pelo backup.ps1 e pelo atualizar.ps1.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = import.meta.dirname;
const envFile = join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = process.env.DATA_DIR || join(root, "data");
const database = join(dataDir, "brique.sqlite");
if (!existsSync(database)) {
  console.log("Banco ainda não criado; nada para copiar.");
  process.exit(0);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
const backups = join(dataDir, "backups");
mkdirSync(backups, { recursive: true });
const target = join(backups, `brique-${stamp}.sqlite`);

const db = new DatabaseSync(database);
try {
  db.exec("PRAGMA busy_timeout = 10000");
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
} finally {
  db.close();
}
console.log(`Banco copiado para ${target}`);
