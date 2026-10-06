#!/usr/bin/env bash
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
  if curl -fsS "http://127.0.0.1:{{PORT}}{{BASE}}/api/v1/health/ready" >/dev/null 2>&1; then
    echo "App no ar em http://127.0.0.1:{{PORT}}{{BASE}} (publique pelo nginx)."
    exit 0
  fi
  sleep 2
done
echo "O app não respondeu. Veja os logs: docker compose logs --tail 100 brique"
exit 1
