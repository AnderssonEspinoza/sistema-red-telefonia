#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_DIR="${1:-}"

if [[ -z "$BACKUP_DIR" || ! -d "$BACKUP_DIR" ]]; then
  echo "Uso: $0 <directorio-backup>" >&2
  exit 1
fi

set -a
source .env
set +a

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Esta operacion restaura PostgreSQL, MariaDB FreePBX, grabaciones y evidencias S3 desde ${BACKUP_DIR}."
  echo "Ejecuta con CONFIRM_RESTORE=YES para confirmar."
  exit 1
fi

docker compose up -d postgres freepbx-db floci freepbx

docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < "${BACKUP_DIR}/postgres.sql"

docker compose exec -T -e MYSQL_PWD="$FREEPBX_DB_ROOT_PASSWORD" freepbx-db \
  mariadb -uroot \
  < "${BACKUP_DIR}/freepbx-mariadb.sql"

if [[ -f "${BACKUP_DIR}/freepbx-recordings.tar.gz" ]]; then
  docker compose exec -T freepbx sh -lc 'mkdir -p /var/spool/asterisk'
  docker compose exec -T freepbx tar -C /var/spool/asterisk -xzf - < "${BACKUP_DIR}/freepbx-recordings.tar.gz"
fi

if [[ -d "${BACKUP_DIR}/s3" ]]; then
  docker run --rm \
    --network sistema-telefonia_default \
    -e AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
    -e AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
    -e AWS_DEFAULT_REGION="${FLOCI_REGION}" \
    -v "${PWD}/${BACKUP_DIR}/s3:/backup-s3" \
    amazon/aws-cli \
    --endpoint-url http://floci:4566 s3 sync /backup-s3 "s3://${EVIDENCE_BUCKET_NAME}" || true
fi

docker compose up -d --force-recreate backend frontend freepbx

echo "Restore terminado"
