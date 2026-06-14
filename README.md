# Sistema de Telefonia

Proyecto local para simular y probar una red telefonica interna usando FreePBX/Asterisk.

La idea es que podamos registrar softphones, llamar entre extensiones, ver las llamadas en un dashboard y probar que el sistema aguanta fallas de algunos servicios usando circuit breaker.

## Que tiene

- FreePBX + Asterisk para la central telefonica.
- Extensiones SIP/PJSIP de prueba: `1001` y `1002`.
- Backend en Node/Express.
- Dashboard en React.
- PostgreSQL para usuarios, llamadas y eventos.
- Floci como nube local para SQS y S3.
- AMI para capturar eventos reales de Asterisk.
- CDR para comparar llamadas con el registro de FreePBX.
- Login para el dashboard.
- Scripts para pruebas, reporte, backup y restore.

## Como levantarlo

Primero copiamos las variables de ejemplo:

```bash
cp .env.example .env
```

Luego levantamos todo:

```bash
docker compose up -d --build
```

Dashboard:

```text
http://localhost:5173
```

Login local:

```text
admin / telefonia_admin_dev
```

Si cambian credenciales en `.env`, reinicien backend y frontend:

```bash
docker compose up -d --build backend frontend
```

## Como trabajar en grupo

Clonar:

```bash
git clone git@github.com:AnderssonEspinoza/sistema-red-telefonia.git
cd sistema-red-telefonia
cp .env.example .env
docker compose up -d --build
```

Antes de subir cambios:

```bash
git pull
git status
./scripts/run-smoke-tests.sh
```

No suban `.env`, `node_modules`, `dist`, `backups` ni `reports`. Ya estan ignorados en `.gitignore`.

Para que alguien pueda hacer push, el dueno del repo debe agregarlo como colaborador en GitHub.

## FreePBX y softphones

Si FreePBX no queda listo o faltan extensiones:

```bash
./scripts/install-freepbx.sh
./scripts/create-demo-extensions.sh
```

Extensiones de prueba:

```text
1001 / Telefonia1001
1002 / Telefonia1002
```

En el softphone:

```text
Servidor: IP LAN de la maquina donde corre Docker
Puerto: 5060 UDP
Usuario: 1001 o 1002
Password: Telefonia1001 o Telefonia1002
```

Si la llamada timbra pero no hay audio:

```bash
./scripts/fix-lan-audio.sh
```

## Demo rapida

1. Abrir el dashboard.
2. Registrar los dos softphones.
3. Llamar de `1001` a `1002`.
4. Contestar y cortar.
5. Revisar que la llamada aparezca en el dashboard.
6. Probar una falla:

```bash
./scripts/demo-circuit-breaker.sh floci-sqs
```

7. Generar reporte:

```bash
./scripts/demo-report.sh
```

El reporte queda en `reports/`.

## Scripts utiles

```bash
./scripts/health.sh
./scripts/run-smoke-tests.sh
./scripts/demo-report.sh
./scripts/backup.sh
```

Restaurar backup:

```bash
CONFIRM_RESTORE=YES ./scripts/restore.sh backups/<fecha>
```

## Puertos

```text
Dashboard:  http://localhost:5173
Backend:    http://localhost:3000
FreePBX:    http://localhost:8081
Floci:      http://localhost:4566
PostgreSQL: localhost:5432
SIP:        5060/udp
RTP:        10000-10100/udp
```

## Documentos

- Instalacion mas detallada: [docs/INSTALL.md](docs/INSTALL.md)
- Guion para presentar: [docs/DEMO.md](docs/DEMO.md)
