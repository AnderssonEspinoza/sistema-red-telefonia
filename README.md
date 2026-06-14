# Sistema de Telefonia

Stack local para el proyecto de central telefonica:

- FreePBX + Asterisk para PBX.
- PostgreSQL para usuarios y llamadas.
- Backend Node/Express con REST, WebSocket, AMI opcional y circuit breaker.
- Floci como nube local compatible con AWS/SQS y S3.
- Dashboard React para monitoreo en tiempo real.
- Login con token para proteger API/dashboard.
- Observabilidad, CDR, reportes, backup y restore.

## Inicio

```bash
cp .env.example .env
docker compose up -d --build postgres floci backend frontend freepbx
```

Abre el dashboard en http://localhost:5173.

Credenciales locales por defecto:

```text
admin / telefonia_admin_dev
```

Cambialas en `.env` antes de presentar el proyecto como entorno productivo.

## Trabajo en grupo

```bash
git clone git@github.com:AnderssonEspinoza/sistema-red-telefonia.git
cd sistema-red-telefonia
cp .env.example .env
docker compose up -d --build
```

Para que otros integrantes puedan hacer `git push`, el dueno del repositorio debe agregarlos como colaboradores en GitHub o darles permisos de escritura al repositorio.

La instalacion de FreePBX se ejecuta aparte:

```bash
./scripts/install-freepbx.sh
```

Crear extensiones SIP de prueba:

```bash
./scripts/create-demo-extensions.sh
```

Corregir audio LAN/RTP si la llamada timbra pero no se escucha:

```bash
./scripts/fix-lan-audio.sh
```

## Flujo de demostracion

1. Registra dos softphones con las extensiones `1001` y `1002`.
2. Llama desde `1001` hacia `1002`.
3. El dashboard muestra la llamada real capturada por AMI: ringing, answer y hangup sobre el mismo registro.
4. El backend publica el evento en Floci SQS y guarda evidencia JSON en Floci S3.
5. Usa `./scripts/demo-circuit-breaker.sh floci-sqs` para abrir y recuperar un circuito sin apagar todo el sistema.
6. Genera evidencia final con `./scripts/demo-report.sh`.

El sistema tambien permite simular una llamada desde el dashboard, pero la demostracion principal debe hacerse con softphones reales conectados a FreePBX/Asterisk.

## Operacion

```bash
./scripts/run-smoke-tests.sh
./scripts/demo-report.sh
./scripts/backup.sh
```

Restaurar requiere confirmacion explicita:

```bash
CONFIRM_RESTORE=YES ./scripts/restore.sh backups/<fecha>
```

Mas detalles en [docs/INSTALL.md](docs/INSTALL.md).
Guion de defensa en [docs/DEMO.md](docs/DEMO.md).
