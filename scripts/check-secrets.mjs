import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
const sourceOnly = process.argv.includes("--source-only");
const keys = [
  "BRIGHTDATA_API_KEY",
  "WORKER_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "PLATFORM_ORIGIN_TOKEN",
  "CF_ACCESS_CLIENT_SECRET",
];
const configs = [
  process.env,
  ...[".env", ".dev.vars"]
    .filter(existsSync)
    .map((f) => parseEnv(readFileSync(f, "utf8"))),
];
const values = [
  ...new Set(
    configs
      .flatMap((config) => keys.map((k) => config[k]))
      .filter((v) => v && v.length >= 8),
  ),
];
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );
if (!sourceOnly && !existsSync("dist/client"))
  throw new Error("Execute o build antes de inspecionar os bundles.");
for (const file of (sourceOnly ? [] : walk("dist")).filter((f) =>
  /\.(js|css|html|json|map)$/.test(f),
)) {
  const content = readFileSync(file, "utf8");
  if (values.some((v) => content.includes(v)))
    throw new Error(`Segredo encontrado no build: ${file}`);
}
const tracked = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (tracked.status === 0) {
  const files = tracked.stdout.split("\0").filter(Boolean);
  if (
    files.some(
      (f) =>
        /(^|\/)(?:\.dev\.vars(?:\..*)?|\.env(?:\..*)?)$/.test(f) &&
        f !== ".env.example",
    )
  )
    throw new Error("Arquivo de configuração privada rastreado pelo Git.");
  if (
    existsSync(".dev.vars") &&
    spawnSync("git", ["check-ignore", "--quiet", ".dev.vars"]).status !== 0
  )
    throw new Error(".dev.vars não está ignorado pelo Git.");
  for (const file of files) {
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    const indexed = spawnSync("git", ["show", `:${file}`], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (indexed.status !== 0)
      throw new Error("Não foi possível inspecionar o índice Git.");
    if (values.some((v) => current.includes(v) || indexed.stdout.includes(v)))
      throw new Error(`Valor secreto encontrado em arquivo rastreado: ${file}`);
  }
  console.log(
    `Git inspecionado: sem correspondências aos ${values.length} valores secretos configurados; configuração privada não rastreada.`,
  );
  const untracked = spawnSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  );
  if (untracked.status !== 0)
    throw new Error("Não foi possível inspecionar arquivos novos.");
  for (const file of untracked.stdout.split("\0").filter(Boolean)) {
    if (values.some((v) => readFileSync(file, "utf8").includes(v)))
      throw new Error(`Segredo encontrado em arquivo novo: ${file}`);
  }
  console.log(
    `Arquivos novos inspecionados contra ${values.length} valores configurados, sem exibir seus conteúdos.`,
  );
}
console.log(
  sourceOnly
    ? `Inspeção direcionada de source concluída (${values.length} valores conhecidos); não é varredura universal de segredos. Bundles NÃO foram verificados.`
    : `Build inspecionado: nenhum valor secreto configurado aparece nos artefatos (${values.length} valores verificados, sem exibi-los).`,
);
