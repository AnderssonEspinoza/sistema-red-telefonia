# Instalacion Local

## Servicios

- Dashboard: http://localhost:5173
- Backend API: http://localhost:3000/api/health
- FreePBX: http://localhost:8081
- Floci AWS local: http://localhost:4566
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- MongoDB: localhost:27017

Si algun puerto ya esta ocupado, cambia el valor correspondiente en `.env`. Por ejemplo:

```text
POSTGRES_PORT=5433
REDIS_PORT=6380
MONGO_PORT=27018
```

El cambio solo afecta el puerto publicado al host. Dentro de Docker los servicios siguen comunicandose por nombre: `postgres:5432`, `redis:6379` y `mongo:27017`.

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
1001 / Telefonia1001
1002 / Telefonia1002
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

Flujo de marcacion:

1. El dashboard llama `POST /api/call-center/dial-next`.
2. El backend valida circuit breaker y llama al `dialer-service`.
3. El marcador toma el siguiente lead desde Redis.
4. El marcador abre AMI hacia FreePBX `5038/tcp`.
5. AMI ejecuta `Originate` sobre `PJSIP/1001`.
6. Cuando el agente contesta, Asterisk entra al contexto `sales-campaign` y marca el lead.
7. El AGI `sales_quality_agi.py` queda disponible como punto de analisis dentro del dialplan.

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
- Redis/Mongo usados para datos operativos del call center.
- Transcripcion visible con PAN de tarjetas enmascarado.
- Texto original cifrado antes de guardarse en MongoDB.
- Diseño documentado para separar voz, aplicacion y datos en VLANs en una red real.

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
