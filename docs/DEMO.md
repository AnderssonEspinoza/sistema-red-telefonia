# Guion de Demo

## Objetivo

Demostrar una red telefonica interna real con FreePBX/Asterisk, monitoreo de llamadas por AMI, persistencia en PostgreSQL, publicacion en Floci SQS, evidencias JSON en Floci S3, CDR, observabilidad, seguridad y circuit breaker por proveedor.

## Preparacion

```bash
docker compose up -d --build postgres floci backend frontend freepbx
./scripts/create-demo-extensions.sh
./scripts/fix-lan-audio.sh
```

Abre:

```text
Dashboard: http://localhost:5173
FreePBX:   http://localhost:8081/admin
Health:    http://localhost:3000/api/health
```

Login del dashboard:

```text
admin / telefonia_admin_dev
```

## Llamada real

1. Configura dos softphones con `1001 / Telefonia1001` y `1002 / Telefonia1002`.
2. Llama desde `1001` hacia `1002`.
3. Contesta en `1002`.
4. Corta la llamada.

Resultado esperado:

- AMI aparece conectado.
- La llamada se actualiza sobre una sola fila: `RINGING`, `ANSWERED`, `HANGUP`.
- La tabla muestra duracion, fuente `ami`, cantidad de eventos y evidencia S3.
- Las extensiones aparecen con estado de registro o actividad.
- El reporte de demo cruza las llamadas recientes con CDR cuando Asterisk ya genero registros.

## Resiliencia

Desde el dashboard, pulsa `Fallar` sobre `Floci SQS`, `Floci S3`, `AMI` o `PostgreSQL`.

Tambien se puede usar terminal:

```bash
./scripts/demo-circuit-breaker.sh floci-sqs
```

Resultado esperado:

- El proveedor fallido pasa a circuito `OPEN`.
- El resto del sistema sigue respondiendo.
- Al pulsar `Recuperar`, el circuito vuelve a `CLOSED` si el servicio real esta disponible.

## Evidencia final

```bash
./scripts/run-smoke-tests.sh
./scripts/demo-report.sh
```

El reporte queda en `reports/demo-*.json` e incluye:

- Estado de proveedores y circuit breakers.
- Llamadas recientes.
- Evidencias S3.
- Eventos de observabilidad.
- CDR recientes y reconciliacion con llamadas AMI.
- Estado de seguridad.

## Recuperacion

```bash
./scripts/backup.sh
```

El backup demuestra operacion real: base de datos del proyecto, base de FreePBX/CDR y evidencias S3.

## Puntos que defender

- La llamada real no es simulada: los softphones se registran contra FreePBX/Asterisk por SIP/PJSIP.
- AMI entrega eventos de Asterisk al backend en tiempo real.
- PostgreSQL conserva usuarios, llamadas y eventos historicos por llamada.
- Floci SQS representa mensajeria asincrona de nube local.
- Floci S3 guarda evidencia JSON auditable por cada evento de llamada.
- El circuit breaker aisla fallas de proveedores y muestra recuperacion controlada.
- El dashboard esta protegido por token; no es una pantalla abierta sin control.
- Hay backup/restore y pruebas automaticas, no solo configuracion manual.
