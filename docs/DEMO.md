# Guion de Demo

## Objetivo

Demostrar una red telefonica interna real con FreePBX/Asterisk, monitoreo de llamadas por AMI, persistencia en PostgreSQL, publicacion en Floci SQS, evidencias JSON en Floci S3, CDR, grabacion, auditoria, SLI/SLO de latencia local, observabilidad, seguridad y circuit breaker por proveedor.

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

## Alta desde dashboard

1. En `Alta rapida`, registra una extension nueva, por ejemplo `1003`.
2. Mantiene activado `Crear extension en FreePBX` y `Grabar llamadas`.
3. Usa la clave SIP mostrada por el dashboard para registrar el softphone.

Resultado esperado:

- La extension aparece en FreePBX como PJSIP.
- El directorio local queda sincronizado con PostgreSQL.
- Auditoria muestra la accion `Usuario creado`.
- La extension queda con grabacion activada.

## Llamada real

1. Configura dos softphones con `1001 / Telefonia1001` y `1002 / Telefonia1002`.
2. Llama desde `1001` hacia `1002`.
3. Contesta en `1002`.
4. Corta la llamada.

Resultado esperado:

- AMI aparece conectado.
- La llamada se actualiza sobre una sola fila: `RINGING`, `ANSWERED`, `HANGUP`.
- La tabla muestra duracion, fuente `ami`, cantidad de eventos y evidencia S3.
- El panel `SLI/SLO - latencia local` muestra RTT dashboard -> API, P95/P99, cumplimiento y SLO configurado.
- Si la llamada fue contestada, FreePBX genera CDR y archivo de grabacion.
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
- Grabaciones enlazadas con CDR.
- Auditoria de acciones de operador.
- SLI/SLO de latencia local publicado por backend y calculado con muestras del dashboard.
- Estado de seguridad.

## Recuperacion

```bash
./scripts/backup.sh
```

El backup demuestra operacion real: base de datos del proyecto, base de FreePBX/CDR y evidencias S3.

## Puntos que defender

- La llamada real no es simulada: los softphones se registran contra FreePBX/Asterisk por SIP/PJSIP.
- AMI entrega eventos de Asterisk al backend en tiempo real.
- El alta de extensiones desde el dashboard usa FreePBX real, no una tabla simulada.
- Las grabaciones dependen de CDR/FreePBX y quedan disponibles como evidencia operativa.
- El SLI no es una metrica decorativa: se mide desde el cliente web hacia la API y cambia el estado visual si se supera el SLO.
- PostgreSQL conserva usuarios, llamadas y eventos historicos por llamada.
- PostgreSQL tambien conserva auditoria de acciones sensibles.
- Floci SQS representa mensajeria asincrona de nube local.
- Floci S3 guarda evidencia JSON auditable por cada evento de llamada.
- El circuit breaker aisla fallas de proveedores y muestra recuperacion controlada.
- El dashboard esta protegido por token; no es una pantalla abierta sin control.
- Hay backup/restore y pruebas automaticas, no solo configuracion manual.
