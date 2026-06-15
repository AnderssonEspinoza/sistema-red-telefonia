#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source scripts/lib-api.sh
api_init

assert_json() {
  local expression="$1"
  ASSERT_EXPRESSION="$expression" node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const data = JSON.parse(input);
      const expression = process.env.ASSERT_EXPRESSION;
      if (!Function("data", `return (${expression});`)(data)) {
        console.error(`Assertion failed: ${expression}`);
        console.error(JSON.stringify(data, null, 2));
        process.exit(1);
      }
    });
  '
}

echo "1. Health"
api_request GET "/api/health" | assert_json "data.ok === true"

echo "2. Observability"
api_request GET "/api/observability" | assert_json "typeof data.metrics.requestCount === 'number' && Array.isArray(data.audit) && data.sli.localLatency.sloMs > 0"

echo "2.1 SLI/SLO local"
api_request GET "/api/sli/ping" | assert_json "data.ok === true && data.sli.name === 'dashboard_to_backend_rtt_ms' && data.sli.sloMs > 0"

echo "3. Call center: servicios, leads y analisis"
api_request GET "/api/call-center/overview" | assert_json "data.health.ok === true && data.health.config.stateStore === 'Redis' && data.health.config.transcriptStore === 'MongoDB' && Array.isArray(data.health.services) && data.health.services.length === 3"
api_request GET "/api/call-center/leads" | assert_json "typeof data.pending === 'number' && Array.isArray(data.leads)"
SMOKE_CALL_ID="smoke-$(date +%s)"
api_request POST "/api/call-center/analyze" "{\"callId\":\"${SMOKE_CALL_ID}\",\"leadName\":\"Cliente smoke\",\"agentExtension\":\"1001\",\"text\":\"Cliente pide precio, demo y plan anual. Menciona tarjeta 4111 1111 1111 1111 para validar mascara.\"}" |
  assert_json "data.ok === true && data.transcript.sensitiveDataMasked === true && data.transcript.analysis.opportunity === true && !data.transcript.maskedText.includes('4111 1111')"
api_request GET "/api/call-center/overview" | assert_json "data.metrics.salesOpportunities >= 1 && data.metrics.sensitiveMasked >= 1 && data.metrics.transcriptsTotal >= 1"

echo "4. Simular y cerrar llamada"
CALL_ID="$(
  api_request POST "/api/simulate-call" '{"extensionOrigen":"1001","extensionDestino":"1002"}' |
    node -e 'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => { const data = JSON.parse(s); if (!data.evidencia_key) process.exit(1); console.log(data.id); });'
)"
api_request POST "/api/calls/${CALL_ID}/end" | assert_json "data.estado === 'COMPLETED' && data.eventos_count >= 2 && Boolean(data.evidencia_key)"

echo "5. Circuit breaker Floci SQS"
api_request POST "/api/demo/failures/floci-sqs" '{"enabled":true}' | assert_json "data.suppliers.some((item) => item.supplier === 'floci-sqs' && item.circuit.state === 'OPEN')"
api_request POST "/api/demo/failures/floci-sqs" '{"enabled":false}' | assert_json "data.suppliers.some((item) => item.supplier === 'floci-sqs' && item.circuit.state === 'CLOSED')"

echo "5.1 Circuit breaker microservicio transcripcion"
api_request POST "/api/demo/failures/transcription" '{"enabled":true}' | assert_json "data.suppliers.some((item) => item.supplier === 'transcription' && item.circuit.state === 'OPEN')"
api_request POST "/api/demo/failures/transcription" '{"enabled":false}' | assert_json "data.suppliers.some((item) => item.supplier === 'transcription' && item.circuit.state === 'CLOSED')"

echo "6. CDR, grabaciones y auditoria"
api_request GET "/api/cdr/reconcile?limit=5" | assert_json "Array.isArray(data.reconciliation)"
api_request GET "/api/recordings?limit=5" | assert_json "data.config.enabled === true && Array.isArray(data.recordings)"
api_request GET "/api/audit?limit=5" | assert_json "Array.isArray(data) && data.length >= 1"

echo "7. Reporte"
api_request GET "/api/demo/report" | assert_json "data.system.ok === true && data.callStats.total >= 1 && Array.isArray(data.audit) && Array.isArray(data.recordings) && data.reliability.sli.localLatency.sloMs > 0 && data.callCenter.health.config.asteriskControl.includes('AGI') && data.callCenter.metrics.salesOpportunities >= 1"

echo "Smoke tests OK"
