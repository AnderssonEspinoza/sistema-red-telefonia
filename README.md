# Sistema de Red Telefonia

Sistema local de telefonia interna basado en FreePBX/Asterisk, con monitoreo de llamadas en tiempo real, persistencia de eventos, SLI/SLO de latencia local, grabacion, evidencias en almacenamiento compatible con S3 y circuit breaker para proveedores externos.

El proyecto permite crear extensiones PJSIP en FreePBX desde el dashboard, registrar softphones, realizar llamadas internas, observar el flujo de llamada y validar escenarios de falla controlada sin depender de servicios cloud reales.

## Arquitectura

| Componente | Tecnologia | Funcion |
| --- | --- | --- |
| PBX | FreePBX + Asterisk | Registro SIP/PJSIP, ruteo de llamadas y CDR |
| Backend | Node.js + Express | API REST, WebSocket, AMI, circuit breaker y reportes |
| Frontend | React + Vite | Dashboard operativo |
| Base de datos | PostgreSQL | Usuarios, llamadas y eventos procesados |
| Cloud local | Floci | SQS para eventos y S3 para evidencias |
| CDR | MariaDB FreePBX | Registro oficial de llamadas de Asterisk |
| Auditoria | PostgreSQL | Acciones de operador y cambios operativos |
| Grabaciones | FreePBX/Asterisk | Audio de llamadas enlazado con CDR |
| SLI/SLO | Dashboard + Backend | Latencia local dashboard -> API y umbral de degradacion |

## Requisitos

- Docker
- Docker Compose
- Git
- Softphone SIP/PJSIP, por ejemplo Zoiper, Linphone o MicroSIP

## Configuracion

Crear el archivo de entorno local:

```bash
cp .env.example .env
```

Las credenciales incluidas son solo para entorno local de desarrollo.

Credenciales del dashboard:

```text
Usuario: admin
Password: telefonia_admin_dev
```

## Ejecucion

Levantar todos los servicios:

```bash
docker compose up -d --build
```

Servicios principales:

```text
Dashboard:  http://localhost:5173
Backend:    http://localhost:3000
FreePBX:    http://localhost:8081
Floci:      http://localhost:4566
PostgreSQL: localhost:5432
```

Puertos de telefonia:

```text
SIP: 5060/udp
AMI: 5038/tcp
RTP: 10000-10100/udp
```

## FreePBX

Instalacion y preparacion de FreePBX:

```bash
./scripts/install-freepbx.sh
./scripts/create-demo-extensions.sh
```

Extensiones de prueba:

```text
1001 / Telefonia1001
1002 / Telefonia1002
```

El dashboard tambien puede crear nuevas extensiones en FreePBX. El formulario `Alta rapida` registra el usuario local, crea la extension PJSIP, activa la grabacion y muestra la clave SIP para configurar el softphone.

Configuracion sugerida para softphones:

```text
Servidor: IP LAN del host Docker
Puerto: 5060 UDP
Usuario: 1001 o 1002
Password: Telefonia1001 o Telefonia1002
```

Si la llamada timbra pero no hay audio:

```bash
./scripts/fix-lan-audio.sh
```

## Flujo de validacion

1. Iniciar sesion en el dashboard.
2. Registrar los softphones `1001` y `1002`.
3. Realizar una llamada de `1001` a `1002`.
4. Contestar y finalizar la llamada.
5. Verificar en el dashboard los estados de llamada, extension, SLI/SLO, circuit breaker, evidencia, auditoria y grabaciones.
6. Generar el reporte de validacion:

```bash
./scripts/demo-report.sh
```

El reporte se genera en `reports/`.

## Pruebas operativas

Health check:

```bash
./scripts/health.sh
```

Pruebas automatizadas:

```bash
./scripts/run-smoke-tests.sh
```

Prueba de circuit breaker:

```bash
./scripts/demo-circuit-breaker.sh floci-sqs
```

Proveedores soportados para falla controlada:

```text
postgres
ami
floci-sqs
floci-s3
```

## Backup y restauracion

Crear backup:

```bash
./scripts/backup.sh
```

Restaurar backup:

```bash
CONFIRM_RESTORE=YES ./scripts/restore.sh backups/<fecha>
```

El backup incluye:

- Base PostgreSQL del sistema
- Base MariaDB de FreePBX y CDR
- Evidencias almacenadas en Floci S3
- Grabaciones almacenadas por FreePBX
- Archivos de configuracion relevantes

## Estructura

```text
backend/        API, AMI, circuit breaker, CDR y reportes
frontend/       Dashboard React
db/             Esquema inicial de PostgreSQL
freepbx/        Configuracion inicial de FreePBX/Asterisk
scripts/        Automatizacion operativa
docs/           Documentacion complementaria
```

## Versionamiento

Los archivos locales y generados no forman parte del repositorio:

```text
.env
node_modules/
dist/
backups/
reports/
```

## Documentacion

- [Instalacion local](docs/INSTALL.md)
- [Guion de demostracion](docs/DEMO.md)
