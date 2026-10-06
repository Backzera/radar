/**
 * Mantém o Market Radar no ar no Windows: lê o .env, inicia app\server.js,
 * reinicia se ele cair e grava os logs em data\logs (14 dias).
 * Quem roda este arquivo é a tarefa agendada criada pelo instalar.ps1.
 */
import { spawn } from "node:child_process";
import {
  createWriteStream,
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
if (existsSync(envFile)) process.loadEnvFile(envFile);
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
let day = "";
let log;
const write = (chunk) => {
  const today = now().slice(0, 10);
  if (today !== day) {
    log?.end();
    day = today;
    log = createWriteStream(join(logDir, `brique-${today}.log`), { flags: "a" });
  }
  log.write(chunk);
};
const note = (message) => write(`[${now()}] ${message}\n`);

let failures = 0;
function start() {
  const startedAt = Date.now();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: join(root, "app"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  // The stop script ends both processes by these ids.
  writeFileSync(join(env.DATA_DIR, "brique.pid"), `${process.pid}\n${child.pid}\n`);
  note(`app iniciado (pid ${child.pid}) em http://${env.HOST}:${env.PORT}${env.BASE_PATH ?? ""}`);
  child.stdout.on("data", write);
  child.stderr.on("data", write);
  child.on("exit", (code, signal) => {
    failures = Date.now() - startedAt > 60_000 ? 1 : failures + 1;
    const wait = Math.min(30_000, 1000 * 2 ** (failures - 1));
    note(`app parou (código ${code ?? signal}); reiniciando em ${wait / 1000}s`);
    setTimeout(start, wait);
  });
}
note("supervisor iniciado");
start();
