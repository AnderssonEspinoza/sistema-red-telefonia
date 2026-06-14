#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

set -a
source .env
set +a

docker compose up -d floci

docker run --rm \
  --network sistema-telefonia_default \
  -e AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
  -e AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
  -e AWS_DEFAULT_REGION="${FLOCI_REGION}" \
  amazon/aws-cli \
  --endpoint-url http://floci:4566 sqs create-queue \
  --queue-name "${CALL_EVENTS_QUEUE_NAME}"

docker run --rm \
  --network sistema-telefonia_default \
  -e AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
  -e AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
  -e AWS_DEFAULT_REGION="${FLOCI_REGION}" \
  amazon/aws-cli \
  --endpoint-url http://floci:4566 s3 mb "s3://${EVIDENCE_BUCKET_NAME}" || true
