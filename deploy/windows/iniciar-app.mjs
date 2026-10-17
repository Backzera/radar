/**
 * Mantém o Ágio no ar no Windows: lê o .env, inicia app\server.js,
 * reinicia se ele cair e grava os logs em data\logs (14 dias).
 * Quem roda este arquivo é a tarefa agendada criada pelo instalar.ps1.
 */
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const root = import.meta.dirname;
const envFile = join(root, ".env");
let envError;
try {
  if (existsSync(envFile)) process.loadEnvFile(envFile);
} catch (error) {
  envError = error;
}
const env = { ...process.env };
const defaults = {
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: "{{PORT}}",
  DATA_DIR: join(root, "data"),
  MIGRATIONS_DIR: join(root, "app", "drizzle"),
  NODE_NO_WARNINGS: "1",
};
for (const [key, value] of Object.entries(defaults)) env[key] ||= value;
const logDir = join(env.DATA_DIR, "logs");
mkdirSync(logDir, { recursive: true });
for (const name of readdirSync(logDir)) {
  const file = join(logDir, name);
  if (Date.now() - statSync(file).mtimeMs > 14 * 86_400_000) rmSync(file, { force: true });
}

// The VPS clock, as in "2026-10-05 22:52:40".
const now = () => new Date().toLocaleString("sv-SE");
// Synchronous, so the reason for a crash is on disk before the process ends.
const write = (chunk) => {
  try {
    appendFileSync(join(logDir, `brique-${now().slice(0, 10)}.log`), chunk);
  } catch {
    // Nowhere else to report it: the task has no console.
  }
};
const note = (message) => write(`[${now()}] ${message}\n`);
process.on("uncaughtException", (error) => {
  note(`erro no supervisor: ${error?.stack ?? error}`);
  process.exit(1);
});

let failures = 0;
function start() {
  const startedAt = Date.now();
  let handled = false;
  const restart = (reason) => {
    if (handled) return;
    handled = true;
    failures = Date.now() - startedAt > 60_000 ? 1 : failures + 1;
    const wait = Math.min(30_000, 1000 * 2 ** (failures - 1));
    note(`${reason}; reiniciando em ${wait / 1000}s`);
    setTimeout(start, wait);
  };
  const child = spawn(process.execPath, ["server.js"], {
    cwd: join(root, "app"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.on("error", (error) => restart(`não consegui iniciar o app (${error.message})`));
  child.on("exit", (code, signal) => restart(`app parou (código ${code ?? signal})`));
  if (!child.pid) return;
  // The stop script ends both processes by these ids.
  writeFileSync(join(env.DATA_DIR, "brique.pid"), `${process.pid}\n${child.pid}\n`);
  note(`app iniciado (pid ${child.pid}) em http://${env.HOST}:${env.PORT}${env.BASE_PATH ?? ""}`);
  child.stdout.on("data", write);
  child.stderr.on("data", write);
}
note("supervisor iniciado");
if (envError) note(`não consegui ler o .env (${envError.message}); seguindo com os valores padrão`);
start();
