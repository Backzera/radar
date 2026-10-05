/**
 * Builds the self-hosted (VPS) version and assembles a package to upload.
 *
 *   npm run vps:build                       → dz7.online/brique (defaults)
 *   npm run vps:build -- --base /outro --origin https://exemplo.com.br
 *
 * Output: release/brique-vps/ and release/brique-vps.tar.gz
 * Environment is set here, not in the shell: Git Bash on Windows would turn
 * "/brique" into "C:/Program Files/Git/brique".
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const base = option("--base", "/brique").replace(/\/+$/, "");
const origin = option("--origin", "https://dz7.online").replace(/\/+$/, "");
const port = Number(option("--port", "3010"));
if (base && !/^\/[a-z0-9][a-z0-9-]*$/i.test(base))
  throw new Error(`--base deve ser como /brique (recebido: ${base})`);
if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin))
  throw new Error(`--origin deve ser como https://dz7.online (recebido: ${origin})`);
const host = new URL(origin).hostname;

const root = resolve(".");
const release = join(root, "release", "brique-vps");
const run = (command, commandArgs, env = {}) => {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

console.log(`\n▶ Build para ${origin}${base}\n`);
run(process.execPath, ["scripts/run-framework.mjs", "build"], {
  RADAR_BUILD_TARGET: "node",
  BASE_PATH: base,
  NODE_ENV: "production",
});
if (!existsSync("dist/standalone/server.js"))
  throw new Error("O build não gerou dist/standalone/server.js.");

console.log("\n▶ Montando o pacote em release/brique-vps\n");
rmSync(release, { recursive: true, force: true });
mkdirSync(join(release, "nginx"), { recursive: true });
cpSync("dist/standalone", join(release, "app"), { recursive: true });
mkdirSync(join(release, "app", "drizzle"));
for (const f of readdirSync("drizzle").filter((f) => f.endsWith(".sql")))
  cpSync(join("drizzle", f), join(release, "app", "drizzle", f));

const files = {
  ".env.example": `# Market Radar (brique) — configuração de produção
# Copie para .env e preencha. Nunca envie o .env para o Git.

# Endereço público, sem barra no final, e o prefixo usado no build.
# O prefixo está embutido no build: para mudar, gere o pacote de novo.
APP_ORIGIN=${origin}
BASE_PATH=${base}

# Login por e-mail e senha do próprio app.
AUTH_MODE=password

# Seu e-mail (vira administrador ao criar a conta em ${origin}${base}/cadastro).
# Vários e-mails: separe por vírgula.
RADAR_ADMIN_EMAILS=

# Radar de anúncios: desligado nesta versão.
COLLECTION_ENABLED=false
PILOT_MODE=true
EXTERNAL_ALERTS_ENABLED=false
ALLOW_LOCAL_DEV_AUTH=false
`,
  Dockerfile: `# Market Radar (brique): servidor Node com SQLite e fotos em /data.
FROM node:24-bookworm-slim
ENV NODE_ENV=production \\
    HOST=0.0.0.0 \\
    PORT=3000 \\
    DATA_DIR=/data \\
    MIGRATIONS_DIR=/srv/brique/drizzle \\
    NODE_NO_WARNINGS=1
WORKDIR /srv/brique
COPY app/ ./
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:3000${base}/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
`,
  "docker-compose.yml": `services:
  brique:
    build: .
    image: brique:latest
    container_name: brique
    restart: unless-stopped
    env_file: .env
    # Só o nginx da própria VPS acessa esta porta.
    ports:
      - "127.0.0.1:${port}:3000"
    volumes:
      - ./data:/data
`,
  "nginx/brique-location.conf": `# Cole dentro do bloco "server" do domínio ${host} (veja LEIA-ME.md).
location ^~ ${base || "/"} {
    proxy_pass http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Fotos de até 3 MB, com folga.
    client_max_body_size 8m;
    proxy_read_timeout 60s;
}
`,
  [`nginx/${host}.conf`]: `# Site completo para ${host}, caso o domínio ainda não tenha configuração no nginx.
# Copie para /etc/nginx/sites-available/${host} e ative (veja LEIA-ME.md).
server {
    listen 80;
    listen [::]:80;
    server_name ${host} www.${host};

    location ^~ ${base || "/"} {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 8m;
        proxy_read_timeout 60s;
    }
${base ? `
    # A raiz do domínio leva para o app enquanto não houver outro site nela.
    location = / {
        return 302 ${base};
    }
` : ""}}

# Depois de instalar o Certificado de Origem da Cloudflare (modo "Full (strict)"),
# descomente o bloco abaixo e ajuste os caminhos do certificado.
# server {
#     listen 443 ssl;
#     listen [::]:443 ssl;
#     http2 on;
#     server_name ${host} www.${host};
#     ssl_certificate     /etc/ssl/cloudflare/${host}.pem;
#     ssl_certificate_key /etc/ssl/cloudflare/${host}.key;
#     include /etc/nginx/snippets/brique-location.conf;
# }
`,
  "brique.service": `# Alternativa sem Docker: serviço systemd (veja LEIA-ME.md, "Sem Docker").
[Unit]
Description=Market Radar (brique)
After=network.target

[Service]
Type=simple
User=brique
WorkingDirectory=/opt/brique/app
EnvironmentFile=/opt/brique/.env
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=${port} DATA_DIR=/opt/brique/data MIGRATIONS_DIR=/opt/brique/app/drizzle NODE_NO_WARNINGS=1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`,
  "backup.sh": `#!/usr/bin/env bash
# Cópia do banco (consistente, com o app rodando) e das fotos. Guarda 14 dias.
# Uso: ./backup.sh   (ou no cron: 0 3 * * * /opt/brique/backup.sh)
set -euo pipefail
cd "$(dirname "$0")"
stamp=$(date +%Y-%m-%d_%H%M)
mkdir -p data/backups
if docker compose ps --status running brique >/dev/null 2>&1; then
  docker compose exec -T brique node -e "new (require('node:sqlite').DatabaseSync)('/data/brique.sqlite').exec(\\"VACUUM INTO '/data/backups/brique-$stamp.sqlite'\\")"
else
  node -e "new (require('node:sqlite').DatabaseSync)('data/brique.sqlite').exec(\\"VACUUM INTO 'data/backups/brique-$stamp.sqlite'\\")"
fi
tar -czf "data/backups/fotos-$stamp.tar.gz" -C data media 2>/dev/null || true
find data/backups -type f -mtime +14 -delete
echo "Backup salvo em data/backups ($stamp)"
`,
  "install.sh": `#!/usr/bin/env bash
# Primeira instalação ou atualização com Docker. Rode na pasta do pacote.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Criei o .env. Coloque seu e-mail em RADAR_ADMIN_EMAILS e rode de novo."
  exit 1
fi
mkdir -p data
# O app roda como o usuário "node" (uid 1000) dentro do container.
chown -R 1000:1000 data 2>/dev/null || sudo chown -R 1000:1000 data
docker compose up -d --build
echo "Aguardando o app responder..."
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${port}${base}/api/v1/health/ready" >/dev/null 2>&1; then
    echo "App no ar em http://127.0.0.1:${port}${base} (publique pelo nginx)."
    exit 0
  fi
  sleep 2
done
echo "O app não respondeu. Veja os logs: docker compose logs --tail 100 brique"
exit 1
`,
};
for (const [name, content] of Object.entries(files))
  writeFileSync(join(release, name), content.replace(/\r\n/g, "\n"));
for (const script of ["backup.sh", "install.sh"]) chmodSync(join(release, script), 0o755);
cpSync("docs/deploy-vps.md", join(release, "LEIA-ME.md"));

console.log("\n▶ Compactando release/brique-vps.tar.gz\n");
run("tar", ["-czf", "release/brique-vps.tar.gz", "-C", "release", "brique-vps"]);
console.log(`\nPronto. Envie release/brique-vps.tar.gz para a VPS e siga o LEIA-ME.md.\n`);
