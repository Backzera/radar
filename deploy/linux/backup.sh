#!/usr/bin/env bash
# Cópia do banco (consistente, com o app rodando) e das fotos. Guarda 14 dias.
# Uso: ./backup.sh   (ou no cron: 0 3 * * * /opt/brique/backup.sh)
set -euo pipefail
cd "$(dirname "$0")"
stamp=$(date +%Y-%m-%d_%H%M)
mkdir -p data/backups
if docker compose ps --status running brique >/dev/null 2>&1; then
  docker compose exec -T brique node -e "new (require('node:sqlite').DatabaseSync)('/data/brique.sqlite').exec(\"VACUUM INTO '/data/backups/brique-$stamp.sqlite'\")"
else
  node -e "new (require('node:sqlite').DatabaseSync)('data/brique.sqlite').exec(\"VACUUM INTO 'data/backups/brique-$stamp.sqlite'\")"
fi
tar -czf "data/backups/fotos-$stamp.tar.gz" -C data media 2>/dev/null || true
find data/backups -type f -mtime +14 -delete
echo "Backup salvo em data/backups ($stamp)"
