#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

set -a
source .env
set +a

BACKUP_DIR="${1:-backups/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$BACKUP_DIR"

echo "Backup en ${BACKUP_DIR}"

docker compose exec -T postgres \
  pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" \
  > "${BACKUP_DIR}/postgres.sql"

docker compose exec -T -e MYSQL_PWD="$FREEPBX_DB_ROOT_PASSWORD" freepbx-db \
  mariadb-dump -uroot --add-drop-database --databases asterisk asteriskcdrdb \
  > "${BACKUP_DIR}/freepbx-mariadb.sql"

cp compose.yaml "${BACKUP_DIR}/compose.yaml"
cp .env "${BACKUP_DIR}/env.snapshot"
cp freepbx/manager_custom.conf "${BACKUP_DIR}/manager_custom.conf"

mkdir -p "${BACKUP_DIR}/s3"
docker run --rm \
  --network sistema-telefonia_default \
  -e AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
  -e AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
  -e AWS_DEFAULT_REGION="${FLOCI_REGION}" \
  -v "${PWD}/${BACKUP_DIR}/s3:/backup-s3" \
  amazon/aws-cli \
  --endpoint-url http://floci:4566 s3 sync "s3://${EVIDENCE_BUCKET_NAME}" /backup-s3 || true

cat > "${BACKUP_DIR}/README.txt" <<TXT
Backup generado: $(date -Iseconds)

Contenido:
- postgres.sql: usuarios, llamadas y eventos.
- freepbx-mariadb.sql: configuracion FreePBX y CDR.
- s3/: evidencias JSON de Floci S3.
- env.snapshot: variables usadas al momento del backup.

Restaurar con:
./scripts/restore.sh ${BACKUP_DIR}
TXT

echo "Backup terminado"
