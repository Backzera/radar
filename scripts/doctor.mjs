import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readLocalConfig } from "./local-config.mjs";

export function nodeCompatible(version, minimum) {
  const actual = version.replace(/^v/, "").split(".").map(Number);
  const target = minimum.replace(/^>=/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(actual[i]) || !Number.isFinite(target[i]))
      return false;
    if (actual[i] !== target[i]) return actual[i] > target[i];
  }
  return true;
}
const walk = (dir) =>
  !existsSync(dir)
    ? []
    : readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : [join(dir, entry.name)],
      );

export async function runDoctor({
  root = process.cwd(),
  environment = process.env,
  transport = fetch,
} = {}) {
  const rows = [],
    next = [];
  const add = (name, status, detail = "") =>
    rows.push({ name, status, detail });
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  add(
    "Node",
    nodeCompatible(process.version, pkg.engines.node) ? "OK" : "ERROR",
    `${process.version}; mínimo ${pkg.engines.node}`,
  );
  add(
    "Dependencies",
    ["vinext", "vite", "wrangler", "typescript"].every((p) =>
      existsSync(join(root, "node_modules", p, "package.json")),
    )
      ? "OK"
      : "ERROR",
  );
  add(".dev.vars", existsSync(join(root, ".dev.vars")) ? "OK" : "ERROR");
  const config = readLocalConfig(root, environment);
  add(
    "WORKER_TOKEN",
    config.WORKER_TOKEN?.length >= 32 &&
      !/[^\x21-\x7e]/.test(config.WORKER_TOKEN)
      ? "OK"
      : "ERROR",
    "valor não exibido",
  );
  add(
    "Scheduler",
    "OK",
    "credencial de serviço; contas processadas isoladamente",
  );
  const key = !!config.BRIGHTDATA_API_KEY?.trim();
  add(
    "Bright Data API Key",
    key ? "CONFIGURED" : "MISSING",
    "nenhuma chamada ao provider",
  );
  if (!key) next.push("Configure BRIGHTDATA_API_KEY em .dev.vars.");
  add(
    "Dataset",
    /^gd_[a-zA-Z0-9]+$/.test(config.BRIGHTDATA_DATASET_ID ?? "")
      ? "OK"
      : "ERROR",
  );
  add(
    "Confirmação de uso",
    config.FACEBOOK_DATA_RIGHTS_CONFIRMED === "true" ? "CONFIRMED" : "PENDING",
  );
  if (config.FACEBOOK_DATA_RIGHTS_CONFIRMED !== "true")
    next.push(
      "Revise termos/licenças antes de confirmar FACEBOOK_DATA_RIGHTS_CONFIRMED.",
    );
  add("Real Mode", "ON", "somente dados reais; sem seed automático");
  const pilot = config.PILOT_MODE !== "false";
  add(
    "Pilot Mode",
    pilot ? "ON" : "OFF",
    pilot
      ? "coletas reais somente por ação manual"
      : "agendamento depende também de COLLECTION_ENABLED e configuração da fonte",
  );
  for (const [name, max] of [
    ["MAX_DAILY_PROVIDER_TRIGGERS", pilot ? 5 : 100],
    ["BRIGHTDATA_MAX_RECORDS_PER_TRIGGER", 100],
  ]) {
    const n = Number(config[name]);
    add(
      name,
      Number.isInteger(n) && n > 0 ? "OK" : "ERROR",
      Number.isInteger(n) && n > 0
        ? `limite efetivo ${Math.min(n, max)}`
        : "use um inteiro positivo",
    );
  }
  add(
    "Alertas externos",
    config.EXTERNAL_ALERTS_ENABLED === "true" ? "ON" : "OFF",
  );
  const git = spawnSync("git", ["check-ignore", "--quiet", ".dev.vars"], {
    cwd: root,
  });
  const tracked = spawnSync(
    "git",
    ["ls-files", "--error-unmatch", ".dev.vars"],
    { cwd: root },
  );
  add(
    ".dev.vars fora do Git",
    git.status === 0 && tracked.status !== 0
      ? "OK"
      : git.status === 128
        ? "WARN"
        : "ERROR",
    git.status === 128
      ? "mantenha a configuração privada ao criar um repositório"
      : "",
  );
  const sqlFiles = readdirSync(join(root, "drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const journalPath = join(root, ".wrangler/radar-migrations.json");
  const journal = existsSync(journalPath)
    ? JSON.parse(readFileSync(journalPath, "utf8"))
    : {};
  let applied = 0,
    changed = false;
  for (const file of sqlFiles) {
    const hash = createHash("sha256")
      .update(readFileSync(join(root, "drizzle", file)))
      .digest("hex");
    if (journal[file] === hash) applied++;
    else if (journal[file]) changed = true;
  }
  add(
    "Migrations",
    !changed && applied === sqlFiles.length ? "OK" : "ERROR",
    changed
      ? "migration aplicada foi alterada"
      : `${applied}/${sqlFiles.length} aplicadas; hashes conferidos`,
  );
  if (applied !== sqlFiles.length)
    next.push("Execute npm run build e npm run db:migrate.");
  let databaseOK = false;
  const { DatabaseSync } = await import("node:sqlite");
  for (const file of walk(join(root, ".wrangler/state/v3/d1")).filter((f) =>
    f.endsWith(".sqlite"),
  )) {
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const names = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name);
      if (
        !["listings", "jobs", "provider_runs", "discovery_observations"].every(
          (name) => names.includes(name),
        )
      )
        continue;
      databaseOK =
        db.prepare("PRAGMA quick_check").get().quick_check === "ok" &&
        db.prepare("PRAGMA foreign_key_check").all().length === 0;
      if (databaseOK) break;
    } catch {
      /* Never expose raw database contents or connection errors. */
    } finally {
      db?.close();
    }
  }
  add(
    "Database",
    databaseOK ? "OK" : "ERROR",
    databaseOK
      ? "SQLite íntegro; leitura sem alterações"
      : "banco local ausente ou incompatível",
  );
  try {
    const url = new URL(config.RADAR_API_URL ?? "http://localhost:5173");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      add(
        "RADAR_API_URL",
        "ERROR",
        "use a origem da API sem credenciais, parâmetros ou caminho",
      );
    } else if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      add(
        "Local API",
        "SKIPPED",
        "doctor só consulta loopback; nenhuma chamada remota",
      );
    } else {
      const response = await transport(`${url.origin}/api/v1/health/live`, {
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      });
      const result = response.ok ? await response.json() : {};
      add(
        "Local API",
        response.ok && result.status === "ok" ? "OK" : "ERROR",
        `${url.origin} · HTTP ${response.status}`,
      );
    }
  } catch {
    add(
      "Local API",
      "WARN",
      "sem resposta; confira RADAR_API_URL e inicie npm run dev",
    );
  }
  return { rows, next, ok: rows.every((row) => row.status !== "ERROR") };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const report = await runDoctor();
    console.log("\nMARKET RADAR Doctor\n");
    for (const row of report.rows)
      console.log(
        `${row.name.padEnd(34)} ${row.status}${row.detail ? ` · ${row.detail}` : ""}`,
      );
    console.log("\nPróximo passo:");
    for (const step of report.next.length
      ? report.next
      : [
          "Meus monitores → Novo monitor → configurar compra, venda, recência e orçamento.",
        ])
      console.log(`- ${step}`);
    console.log(
      "Depois de editar .dev.vars, reinicie o servidor e o worker. Doctor não executa coletas; consulte o histórico da fonte para ver execuções reais.",
    );
    process.exitCode = report.ok ? 0 : 1;
  } catch {
    console.error(
      "Doctor não pôde ler a configuração local. Execute na pasta do projeto e confira a configuração; nenhum segredo foi exibido.",
    );
    process.exitCode = 1;
  }
}
