#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source scripts/lib-api.sh
api_init

SUPPLIER="${1:-floci-sqs}"

case "$SUPPLIER" in
  postgres|ami|floci-sqs|floci-s3|dialer|transcription|metrics) ;;
  *)
    echo "Proveedor invalido: $SUPPLIER" >&2
    echo "Uso: $0 [postgres|ami|floci-sqs|floci-s3|dialer|transcription|metrics]" >&2
    exit 1
    ;;
esac

print_supplier() {
  if command -v jq >/dev/null 2>&1; then
    jq ".suppliers[] | select(.supplier == \"${SUPPLIER}\")"
  elif command -v node >/dev/null 2>&1; then
    node -e '
      const supplier = process.argv[1];
      let input = "";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => {
        const data = JSON.parse(input);
        const row = (data.suppliers || []).find((item) => item.supplier === supplier) || data;
        console.log(JSON.stringify(row, null, 2));
      });
    ' "$SUPPLIER"
  else
    cat
  fi
}

echo "Estado inicial"
api_request GET "/api/health" | print_supplier

echo
echo "Activando falla controlada para ${SUPPLIER}"
api_request POST "/api/demo/failures/${SUPPLIER}" '{"enabled":true}' | print_supplier

echo
echo "Verificando que el dashboard/API siguen respondiendo durante la falla"
api_request GET "/api/health" | print_supplier

echo
echo "Recuperando ${SUPPLIER}"
api_request POST "/api/demo/failures/${SUPPLIER}" '{"enabled":false}' | print_supplier
