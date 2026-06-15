#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source scripts/lib-api.sh
api_init

mkdir -p reports
REPORT_FILE="reports/demo-$(date +%Y%m%d-%H%M%S).json"

api_request GET "/api/demo/report" > "$REPORT_FILE"

node - "$REPORT_FILE" <<'NODE'
const fs = require('fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

console.log(`Reporte: ${process.argv[2]}`);
console.log(`Sistema OK: ${report.system.ok}`);
console.log(`Auth activo: ${report.security.authEnabled}`);
console.log(`Llamadas: ${report.callStats.total}`);
console.log(`Evidencias total: ${report.evidence.callsWithEvidence} (${report.evidence.coveragePercent}%)`);
console.log(`Evidencias 24h: ${report.callStats.recentWithEvidence}/${report.callStats.recentTotal} (${report.callStats.recentEvidenceCoveragePercent}%)`);
console.log(`CDR recientes: ${report.recentCdr.length}`);
if (report.callCenter?.metrics) {
  console.log(`Call center: ${report.callCenter.metrics.callsTotal} marcaciones, ${report.callCenter.metrics.salesOpportunities} oportunidades, ${report.callCenter.metrics.sensitiveMasked} enmascaradas`);
}
console.log('Proveedores:');
for (const supplier of report.system.suppliers) {
  console.log(`- ${supplier.label}: ${supplier.ok ? 'OK' : 'FALLA'} / ${supplier.circuit.state}`);
}
NODE
