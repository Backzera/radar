/**
 * Builds the self-hosted (VPS) version and assembles a package to upload.
 *
 *   npm run vps:build                       → Windows VPS, dz7.online/brique (defaults)
 *   npm run vps:build -- --os linux         → Linux VPS (Docker or systemd, nginx)
 *   npm run vps:build -- --base /outro --origin https://exemplo.com.br --port 3010
 *
 * Output: release/brique-windows.zip or release/brique-linux.tar.gz (and the folder).
 * The scripts and configs come from deploy/<os>/, with {{PLACEHOLDERS}} filled in.
 * Environment is set here, not in the shell: Git Bash on Windows would turn
 * "/brique" into "C:/Program Files/Git/brique".
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const target = option("--os", "windows");
const base = option("--base", "/brique").replace(/\/+$/, "");
const origin = option("--origin", "https://dz7.online").replace(/\/+$/, "");
const port = Number(option("--port", "3010"));
if (target !== "windows" && target !== "linux")
  throw new Error(`--os deve ser windows ou linux (recebido: ${target})`);
if (!/^\/[a-z0-9][a-z0-9-]*$/i.test(base))
  throw new Error(`--base deve ser como /brique (recebido: ${base || "vazio"})`);
if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin))
  throw new Error(`--origin deve ser como https://dz7.online (recebido: ${origin})`);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error(`--port deve ser um número entre 1024 e 65535 (recebido: ${port})`);
const host = new URL(origin).hostname;
const values = {
  ORIGIN: origin,
  BASE: base,
  BASE_NO_SLASH: base.slice(1),
  PORT: String(port),
  HOST: host,
};

const root = resolve(".");
const name = `brique-${target}`;
const release = join(root, "release", name);
const run = (command, commandArgs, env = {}, cwd = root) => {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    cwd,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const fill = (text, file) =>
  text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Marcador {{${key}}} desconhecido em ${file}`);
    return values[key];
  });

console.log(`\n▶ Build para ${origin}${base} (VPS ${target})\n`);
run(process.execPath, ["scripts/run-framework.mjs", "build"], {
  RADAR_BUILD_TARGET: "node",
  BASE_PATH: base,
  NODE_ENV: "production",
});
if (!existsSync("dist/standalone/server.js"))
  throw new Error("O build não gerou dist/standalone/server.js.");

console.log(`\n▶ Montando o pacote em release/${name}\n`);
rmSync(release, { recursive: true, force: true });
mkdirSync(release, { recursive: true });
cpSync("dist/standalone", join(release, "app"), { recursive: true });
mkdirSync(join(release, "app", "drizzle"));
for (const f of readdirSync("drizzle").filter((f) => f.endsWith(".sql")))
  cpSync(join("drizzle", f), join(release, "app", "drizzle", f));

const source = join(root, "deploy", target);
const templates = readdirSync(source, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(source, join(entry.parentPath, entry.name)));
const guide = `docs/deploy-vps-${target}.md`;
for (const file of [...templates, "LEIA-ME.md"]) {
  const from = file === "LEIA-ME.md" ? guide : join(source, file);
  let text = fill(readFileSync(from, "utf8"), file).replace(/\r\n/g, "\n");
  // Windows: CRLF for old Notepad, and a UTF-8 BOM on .ps1 because Windows
  // PowerShell 5.1 reads scripts without one as ANSI and breaks the accents.
  if (target === "windows") {
    text = text.replace(/\n/g, "\r\n");
    if (file.endsWith(".ps1")) text = `\uFEFF${text}`;
  }
  const to = join(release, fill(file, file));
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, text);
  if (file.endsWith(".sh")) chmodSync(to, 0o755);
}

const releaseDir = join(root, "release");
if (target === "windows") {
  console.log(`\n▶ Compactando release/${name}.zip\n`);
  rmSync(join(releaseDir, `${name}.zip`), { force: true });
  // The bsdtar that ships with Windows writes zip; Git Bash's GNU tar does not.
  if (process.platform === "win32") {
    const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    run(tar, ["-a", "-c", "-f", `${name}.zip`, name], {}, releaseDir);
  } else run("zip", ["-qr", `${name}.zip`, name], {}, releaseDir);
  console.log(`\nPronto. Envie release/${name}.zip para a VPS e siga o LEIA-ME.md.\n`);
} else {
  console.log(`\n▶ Compactando release/${name}.tar.gz\n`);
  run("tar", ["-czf", `${name}.tar.gz`, name], {}, releaseDir);
  console.log(`\nPronto. Envie release/${name}.tar.gz para a VPS e siga o LEIA-ME.md.\n`);
}
