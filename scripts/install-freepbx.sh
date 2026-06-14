#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

set -a
source .env
set +a

docker compose up -d freepbx-db freepbx

echo "Esperando MariaDB de FreePBX..."
until docker compose exec -T freepbx-db mariadb-admin ping -h 127.0.0.1 -uroot -p"${FREEPBX_DB_ROOT_PASSWORD}" --silent >/dev/null 2>&1; do
  sleep 3
done

echo "Esperando Asterisk..."
until docker compose exec -T freepbx asterisk -rx 'core show version' >/dev/null 2>&1; do
  sleep 3
done

if docker compose exec -T freepbx test -f /etc/freepbx.conf; then
  echo "FreePBX ya esta instalado."
else
  echo "Inicializando FreePBX..."
  set +e
  docker compose exec -T -w /usr/local/src/freepbx freepbx php install -n \
    --dbuser="${FREEPBX_DB_USER}" \
    --dbpass="${FREEPBX_DB_PASSWORD}" \
    --dbhost=freepbx-db
  install_status=$?
  set -e

  if [[ "$install_status" -ne 0 ]] && ! docker compose exec -T freepbx test -f /etc/freepbx.conf; then
    exit "$install_status"
  fi
fi

if docker compose exec -T freepbx test -x /usr/sbin/fwconsole; then
  docker compose exec -T freepbx fwconsole reload
fi

echo "FreePBX queda disponible en http://localhost:${FREEPBX_HTTP_PORT}"
