# Sistema de Red Telefonia

Sistema local de operaciones de ventas tipo call center sobre FreePBX/Asterisk. Permite registrar extensiones PJSIP, usar softphones reales, originar llamadas desde un marcador Python, observar eventos AMI en tiempo real, guardar evidencias, analizar transcripciones y probar resiliencia por circuit breaker.

El entorno se ejecuta completo con Docker Compose. No depende de una nube externa: Floci simula SQS/S3 localmente, Redis mantiene estado operativo de marcacion y MongoDB almacena transcripciones.

El modo activo del laboratorio es:

```text
CALL_MODE=lab_internal
```

En este modo los leads son clientes simulados por softphone (`9001-9005`). No hay SIP trunk ni llamadas reales a PSTN.

## Arquitectura

| Componente | Tecnologia | Funcion |
| --- | --- | --- |
| PBX | FreePBX + Asterisk | Registro SIP/PJSIP, ruteo de llamadas, CDR, grabaciones y AMI |
| Marcador | Python + FastAPI + AMI | Toma leads desde Redis y origina llamadas reales en Asterisk |
| AGI | Python + Asterisk AGI | Punto de integracion en dialplan para analisis de calidad |
| Transcripcion | Python + FastAPI + MongoDB | Guarda texto de llamadas, enmascara tarjetas y calcula oportunidad/calidad |
| Metricas | Python + FastAPI | Resume leads, marcaciones, contestadas, oportunidades y datos sensibles |
| Backend | Node.js + Express | API, WebSocket, AMI listener, reportes, auditoria y circuit breaker |
| Frontend | React + Vite | Dashboard operativo |
| Base operativa | PostgreSQL | Usuarios, llamadas, eventos y auditoria |
| Estado realtime | Redis | Leads pendientes y estado de llamadas de campana |
| Transcripciones | MongoDB | Texto analizado, metadata y original cifrado |
| Cloud local | Floci | SQS para eventos y S3 para evidencias JSON |
| CDR | MariaDB FreePBX | Registro oficial de llamadas de Asterisk |

## Requisitos

- Docker
- Docker Compose
- Git
- Softphone SIP/PJSIP: Zoiper, Linphone, MicroSIP u otro cliente compatible

## Configuracion

```bash
cp .env.example .env
```

Credenciales locales del dashboard:

```text
Usuario: admin
Password: telefonia_admin_dev
```

Las credenciales incluidas son de laboratorio. Para una entrega formal cambia `AUTH_PASSWORD`, `AUTH_TOKEN_SECRET`, `AMI_SECRET` y `FREEPBX_PROVISIONER_TOKEN`.

## Ejecucion

```bash
docker compose up -d --build
```

Servicios publicados al host:

```text
Dashboard:   http://localhost:5173
Backend:     http://localhost:3000
FreePBX:     http://localhost:8081
```

Puertos de telefonia:

```text
SIP/PJSIP: 5060/udp
RTP:       10000-10100/udp
WebSocket: 8088/tcp
```

Los microservicios Python (`dialer-service`, `transcription-service`, `metrics-service`) no se publican al host. El backend los consume dentro de la red Docker por HTTP interno.

PostgreSQL, Redis, MongoDB, Floci y AMI quedan internos por defecto. Para depuracion local:

```bash
docker compose -f compose.yaml -f compose.dev-ports.yaml up -d
```

La segmentacion del laboratorio se documenta en [VLANs, subredes y firewall](docs/VLAN_FIREWALL.md). El proyecto separa contenedores por redes Docker y deja un script nftables para aplicar reglas entre Empresa, Clientes y PBX cuando existan VLANs o subredes reales.

## FreePBX y softphones

Preparacion inicial:

```bash
./scripts/install-freepbx.sh
./scripts/create-demo-extensions.sh
```

Extensiones de prueba:

```text
1001 Soporte / Telefonia1001
1002 Agente / Telefonia1002
1003 Soporte 2 / Telefonia1003
1004 Agente / Telefonia1004
2001 Marketing / Telefonia2001
3001 Ventas / Telefonia3001
4001 Supervisor / Telefonia4001
9001 Cliente Carlos / Telefonia9001
9002 Cliente Maria / Telefonia9002
9003 Cliente Empresa Demo / Telefonia9003
9004 Cliente Reclamo / Telefonia9004
9005 Cliente Interesado / Telefonia9005
```

Configuracion del softphone:

```text
Servidor/SIP domain: IP LAN del host Docker
Puerto: 5060 UDP
Usuario: 1001 o 1002
Password: Telefonia1001 o Telefonia1002
```

Si la llamada timbra pero no hay audio:

```bash
./scripts/fix-lan-audio.sh
```

## Flujo de uso

1. Iniciar sesion en el dashboard.
2. Registrar los softphones `1001` y `1002` contra FreePBX.
3. Usar `Marcar lead` o `Marcar siguiente lead` para que el marcador Python origine una llamada por AMI.
4. Contestar en el agente `1001`; Asterisk continua el flujo hacia un cliente simulado `9001-9005`.
5. Probar el IVR llamando desde `9001` a `5000` y presionando `1` para soporte.
6. Cortar la llamada y revisar tabla de llamadas, CDR, evidencias y grabaciones.
7. Usar `Analizar texto demo` para validar MongoDB, deteccion de oportunidad y enmascaramiento de tarjeta.
8. Probar fallas controladas en proveedores desde `Circuit breaker - proveedores`.

El boton `Registrar llamada demo` solo crea datos controlados para pruebas sin softphones. La marcacion de leads usa AMI contra Asterisk.

## Pruebas

Health check:

```bash
./scripts/health.sh
```

Pruebas automatizadas:

```bash
./scripts/run-smoke-tests.sh
```

Circuit breaker:

```bash
./scripts/demo-circuit-breaker.sh floci-sqs
./scripts/demo-circuit-breaker.sh transcription
```

Proveedores con falla controlada:

```text
postgres
ami
floci-sqs
floci-s3
dialer
transcription
metrics
```

## Reporte

```bash
./scripts/demo-report.sh
```

El reporte se genera en `reports/` e incluye salud de proveedores, circuit breakers, llamadas, CDR, grabaciones, evidencias S3, auditoria, configuracion de seguridad y resumen de call center.

## Backup y restauracion

```bash
./scripts/backup.sh
CONFIRM_RESTORE=YES ./scripts/restore.sh backups/<fecha>
```

El backup incluye PostgreSQL, MariaDB de FreePBX/CDR, evidencias Floci S3, grabaciones y configuracion relevante.

## Estructura

```text
backend/        API, AMI, circuit breaker, CDR, reportes y call center facade
frontend/       Dashboard React
services/       Microservicios Python de marcador, transcripcion y metricas
db/             Esquema inicial de PostgreSQL
freepbx/        Provisionador, AMI custom, AGI y dialplan custom
scripts/        Automatizacion operativa
docs/           Documentacion complementaria
```

## Documentacion

- [Instalacion local](docs/INSTALL.md)
- [Guion de demostracion](docs/DEMO.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [VLANs, subredes y firewall](docs/VLAN_FIREWALL.md)
- [Pruebas remotas con Tailscale](docs/TAILSCALE.md)
- [Preparacion futura para SIP trunk](docs/SIP_TRUNK_READY.md)
