# Instalacion Local

## Servicios

- Dashboard: http://localhost:5173
- Backend API: http://localhost:3000/api/health
- Floci AWS local: http://localhost:4566
- FreePBX: http://localhost:8081
- PostgreSQL: localhost:5432

## Arranque principal

```bash
cp .env.example .env
docker compose up -d --build postgres floci backend frontend freepbx
```

El backend migra el esquema de PostgreSQL al iniciar. Tambien crea la cola `call-events` en Floci SQS y el bucket `telefonia-evidencias` en Floci S3.

## Acceso

El dashboard esta protegido por login local:

```text
Usuario: admin
Password: telefonia_admin_dev
```

Valores en `.env`:

```text
AUTH_ENABLED=true
AUTH_USERNAME=admin
AUTH_PASSWORD=telefonia_admin_dev
AUTH_TOKEN_SECRET=telefonia_local_secret_change_me
```

Para una entrega formal cambia `AUTH_PASSWORD` y `AUTH_TOKEN_SECRET`, luego reinicia backend/frontend.

## FreePBX y Asterisk

```bash
./scripts/install-freepbx.sh
```

Despues entra a `http://localhost:8081`, termina el asistente inicial de FreePBX y crea las extensiones `1001` y `1002`.

Para audio RTP en esta configuracion local se expone `10000-10100/udp`. En FreePBX configura el rango RTP con esos mismos puertos.

Para crear automaticamente las extensiones de prueba:

```bash
./scripts/create-demo-extensions.sh
```

Extensiones creadas:

```text
1001 / Telefonia1001
1002 / Telefonia1002
```

Si las llamadas timbran pero no hay audio, aplica la configuracion LAN/RTP:

```bash
./scripts/fix-lan-audio.sh
```

Despues revisa en FreePBX:

- `Settings > Asterisk SIP Settings`: External Address debe ser la IP LAN del host.
- RTP debe usar `10000-10100`.
- Los softphones deben estar en la misma red que la IP LAN publicada por FreePBX.

## AMI

El Compose monta `freepbx/manager_custom.conf` con un usuario AMI de desarrollo:

```text
AMI_USERNAME=telefonia
AMI_SECRET=telefonia_ami_dev
```

Si cambias esos valores, reinicia FreePBX y backend:

```bash
docker compose up -d --force-recreate freepbx
docker compose up -d --build backend
```

## Prueba rapida sin softphones

```bash
curl -X POST http://localhost:3000/api/simulate-call \
  -H 'Content-Type: application/json' \
  -d '{"extensionOrigen":"1001","extensionDestino":"1002"}'
```

El dashboard debe mostrar la llamada en vivo.

## Prueba real con softphones

Configura dos softphones PJSIP:

```text
Servidor/SIP domain: IP LAN del host
Puerto: 5060 UDP
Extension 1001 / Password Telefonia1001
Extension 1002 / Password Telefonia1002
```

Llama de `1001` a `1002`. En el dashboard deben verse los cambios de estado capturados por AMI y una referencia de evidencia S3 en la tabla de llamadas.

## Circuit breaker

El dashboard incluye botones para forzar fallas controladas en:

- PostgreSQL
- Asterisk AMI
- Floci SQS
- Floci S3

Tambien puedes ejecutar:

```bash
./scripts/demo-circuit-breaker.sh floci-sqs
```

La prueba abre el circuito, genera una llamada simulada y luego recupera el proveedor.

## Verificacion

```bash
./scripts/health.sh
```

Endpoints utiles:

```text
GET  /api/health
GET  /api/extensions/status
GET  /api/observability
GET  /api/cdr/reconcile
GET  /api/demo/report
POST /api/demo/failures/:supplier
```

Los endpoints distintos de `/api/health` y `/api/auth/*` requieren `Authorization: Bearer <token>`.

## Pruebas automaticas

```bash
./scripts/run-smoke-tests.sh
```

Valida login, health, observabilidad, llamada simulada, cierre con evidencia, circuit breaker, CDR y reporte.

## Backup y restore

Backup:

```bash
./scripts/backup.sh
```

Incluye PostgreSQL, MariaDB de FreePBX/CDR, configuracion relevante y evidencias S3.

Restore:

```bash
CONFIRM_RESTORE=YES ./scripts/restore.sh backups/<fecha>
```

El restore recrea backend, frontend y FreePBX al final.
