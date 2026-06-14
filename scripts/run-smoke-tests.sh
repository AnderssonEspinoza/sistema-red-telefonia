#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source scripts/lib-api.sh
api_init

assert_json() {
  local expression="$1"
  ASSERT_EXPRESSION="$expression" node <<'NODE'
    let input = '';
    process.stdin.on('data', (chunk) => input += chunk);
    process.stdin.on('end', () => {
      const data = JSON.parse(input);
      const expression = process.env.ASSERT_EXPRESSION;
      if (!Function('data', `return (${expression});`)(data)) {
        console.error(`Assertion failed: ${expression}`);
        console.error(JSON.stringify(data, null, 2));
        process.exit(1);
      }
    });
NODE
}

echo "1. Health"
api_request GET "/api/health" | assert_json "data.ok === true"

echo "2. Observability"
api_request GET "/api/observability" | assert_json "typeof data.metrics.requestCount === 'number'"

echo "3. Simular y cerrar llamada"
CALL_ID="$(
  api_request POST "/api/simulate-call" '{"extensionOrigen":"1001","extensionDestino":"1002"}' |
    node -e 'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => { const data = JSON.parse(s); if (!data.evidencia_key) process.exit(1); console.log(data.id); });'
)"
api_request POST "/api/calls/${CALL_ID}/end" | assert_json "data.estado === 'COMPLETED' && data.eventos_count >= 2 && Boolean(data.evidencia_key)"

echo "4. Circuit breaker Floci SQS"
api_request POST "/api/demo/failures/floci-sqs" '{"enabled":true}' | assert_json "data.suppliers.some((item) => item.supplier === 'floci-sqs' && item.circuit.state === 'OPEN')"
api_request POST "/api/demo/failures/floci-sqs" '{"enabled":false}' | assert_json "data.suppliers.some((item) => item.supplier === 'floci-sqs' && item.circuit.state === 'CLOSED')"

echo "5. CDR y reporte"
api_request GET "/api/cdr/reconcile?limit=5" | assert_json "Array.isArray(data.reconciliation)"
api_request GET "/api/demo/report" | assert_json "data.system.ok === true && data.callStats.total >= 1"

echo "Smoke tests OK"
