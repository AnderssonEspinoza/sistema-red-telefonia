# Instalacion Local

## Servicios

- Dashboard: http://localhost:5173
- Backend API: http://localhost:3000/api/health
- FreePBX: http://localhost:8081

PostgreSQL, Redis, MongoDB, Floci y AMI quedan internos por defecto. Para publicarlos al host en desarrollo:

```bash
docker compose -f compose.yaml -f compose.dev-ports.yaml up -d
```

Si algun puerto de datos ya esta ocupado, cambia el valor correspondiente en `.env`: `POSTGRES_PORT`, `REDIS_PORT`, `MONGO_PORT`, `FLOCI_PORT` o `AMI_HOST_PORT`.

## Arranque

```bash
cp .env.example .env
docker compose up -d --build
```

El backend migra PostgreSQL al iniciar. Floci crea la cola `call-events` y el bucket `telefonia-evidencias`. FreePBX monta el provisionador de extensiones, el usuario AMI, el dialplan custom y el AGI Python.

## Acceso

```text
Usuario: admin
Password: telefonia_admin_dev
```

Variables principales:

```text
AUTH_ENABLED=true
AUTH_USERNAME=admin
AUTH_PASSWORD=telefonia_admin_dev
AUTH_TOKEN_SECRET=telefonia_local_secret_change_me

AMI_USERNAME=telefonia
AMI_SECRET=telefonia_ami_dev
DEFAULT_AGENT_EXTENSION=1001
MAX_ACTIVE_DIALS=4
CALL_MODE=lab_internal
```

Para una entrega formal cambia las claves y recrea los servicios:

```bash
docker compose up -d --build --force-recreate backend freepbx dialer-service
```

## FreePBX y Asterisk

```bash
./scripts/install-freepbx.sh
./scripts/create-demo-extensions.sh
```

Extensiones creadas:

```text
Red Empresa:
1001 Soporte / Telefonia1001
1002 Agente / Telefonia1002
1003 Soporte 2 / Telefonia1003
1004 Agente / Telefonia1004
2001 Marketing / Telefonia2001
3001 Ventas / Telefonia3001
4001 Supervisor / Telefonia4001

Red Clientes Simulados:
9001 Cliente Carlos / Telefonia9001
9002 Cliente Maria / Telefonia9002
9003 Cliente Empresa Demo / Telefonia9003
9004 Cliente Reclamo / Telefonia9004
9005 Cliente Interesado / Telefonia9005
```

El dashboard tambien puede crear extensiones adicionales. El backend llama al provisionador interno de FreePBX, crea el usuario PJSIP, activa grabacion y registra el usuario en PostgreSQL.

Para audio RTP en red local:

```bash
./scripts/fix-lan-audio.sh
```

Revisar en FreePBX:

- `Settings > Asterisk SIP Settings`: External Address debe ser la IP LAN del host.
- RTP debe usar `10000-10100`.
- Los softphones deben registrarse contra la IP LAN del host Docker.

## Softphones

Configuracion base:

```text
Servidor/SIP domain: IP LAN del host Docker
Puerto: 5060 UDP
Extension 1001 / Password Telefonia1001
Extension 1002 / Password Telefonia1002
```

El softphone se conecta a FreePBX/Asterisk, no al backend.

## Call center

Servicios internos:

```text
dialer-service:7010          Marcador Python
transcription-service:7020   Transcripcion, calidad y enmascaramiento
metrics-service:7030         Resumen operacional
redis:6379                   Leads y estado realtime
mongo:27017                  Transcripciones
```

Modo de llamadas:

```text
CALL_MODE=lab_internal
```

En este modo los leads son `9001-9005`. El sistema no marca PSTN ni numeros externos reales.

Flujo de marcacion:

1. El dashboard llama `POST /api/call-center/dial-next`.
2. El backend valida circuit breaker y llama al `dialer-service`.
3. El marcador toma el siguiente lead desde Redis.
4. El marcador abre AMI hacia FreePBX `5038/tcp`.
5. AMI ejecuta `Originate` sobre `PJSIP/1001`.
6. Cuando el agente contesta, Asterisk entra al contexto `sales-campaign` y marca el lead.
7. El AGI `sales_quality_agi.py` queda disponible como punto de analisis dentro del dialplan.

Flujo inbound de clientes:

1. El cliente simulado `9001` llama a `5000`.
2. Entra al IVR principal.
3. Presiona `1` para soporte.
4. Asterisk timbra `1001`, `1002` y `1003`.
5. La llamada queda en AMI/CDR/grabaciones.

Reglas:

- Empresa puede llamar a clientes `9001-9005`.
- Clientes pueden llamar al IVR `5000`.
- Clientes no pueden llamar directo al supervisor `4001`.

El contexto custom esta en:

```text
freepbx/extensions_custom.conf
freepbx/agi/sales_quality_agi.py
```

Despues de cambiar dialplan o AGI:

```bash
docker compose exec freepbx fwconsole reload
```

## Seguridad implementada

- Login del dashboard con token.
- AMI con usuario dedicado.
- Provisionador FreePBX protegido por token.
- Microservicios no publicados al host.
- AMI, PostgreSQL, Redis, MongoDB y Floci no publicados al host por defecto.
- Redis/Mongo usados para datos operativos del call center.
- Transcripcion visible con PAN de tarjetas enmascarado.
- Texto original cifrado antes de guardarse en MongoDB.
- Diseño documentado para separar voz, aplicacion y datos en VLANs en una red real: `docs/VLAN_FIREWALL.md`.

## Endpoints utiles

```text
GET  /api/health
GET  /api/extensions/status
GET  /api/observability
GET  /api/call-center/overview
GET  /api/call-center/leads
GET  /api/call-center/transcripts
GET  /api/call-center/security
GET  /api/recordings
GET  /api/cdr/reconcile
GET  /api/demo/report
POST /api/call-center/dial-next
POST /api/call-center/analyze
POST /api/demo/failures/:supplier
```

Los endpoints distintos de `/api/health` y `/api/auth/*` requieren `Authorization: Bearer <token>`.

## Circuit breaker

Proveedores soportados:

```text
postgres
ami
floci-sqs
floci-s3
dialer
transcription
metrics
```

Prueba:

```bash
./scripts/demo-circuit-breaker.sh transcription
```

## Pruebas

```bash
./scripts/health.sh
./scripts/run-smoke-tests.sh
```

Las pruebas validan login, health, observabilidad, call center, transcripcion con enmascaramiento, llamada simulada con evidencia, circuit breaker, CDR, grabaciones, auditoria y reporte.

## Backup y restore

```bash
./scripts/backup.sh
CONFIRM_RESTORE=YES ./scripts/restore.sh backups/<fecha>
```

Incluye PostgreSQL, MariaDB de FreePBX/CDR, grabaciones, configuracion relevante y evidencias S3.
