import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
let config;
try {
  config = JSON.parse(readFileSync("wrangler.production.json", "utf8"));
} catch {
  throw new Error(
    "Crie wrangler.production.json a partir do exemplo com recursos existentes autorizados. Este comando não cria recursos nem publica.",
  );
}
if (
  !config.name ||
  config.d1_databases?.length !== 1 ||
  config.d1_databases[0].binding !== "DB" ||
  !/^[a-f0-9-]{36}$/i.test(config.d1_databases[0].database_id ?? "") ||
  /^(0|-)+$/.test(config.d1_databases[0].database_id) ||
  config.d1_databases[0].database_id === "00000000-0000-4000-8000-000000000000"
)
  throw new Error(
    "Nome e binding DB real são obrigatórios; não usar placeholder.",
  );
if (
  config.vars?.AUTH_MODE !== "cloudflare-access" ||
  !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(
    config.vars.ACCESS_ISSUER ?? "",
  ) ||
  !config.vars.ACCESS_AUDIENCE ||
  config.vars.ALLOW_LOCAL_DEV_AUTH === "true"
)
  throw new Error(
    "Perfil de autenticação de produção precisa de issuer/audience; acesso local não é permitido.",
  );
for (const key of Object.keys(config.vars ?? {}))
  if (/TOKEN|SECRET|API_KEY/.test(key))
    throw new Error(
      "Segredos não devem constar no arquivo de configuração do build.",
    );
const result = spawnSync(
  process.execPath,
  ["scripts/run-framework.mjs", "build"],
  {
    stdio: "inherit",
    env: { ...process.env, RADAR_BUILD_TARGET: "production" },
  },
);
process.exit(result.status ?? 1);
