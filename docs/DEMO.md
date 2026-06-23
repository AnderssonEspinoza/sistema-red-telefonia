# Guion de Demo

## Objetivo

Demostrar un call center VoIP privado sobre FreePBX/Asterisk con dos segmentos logicos: Red Empresa y Red Clientes Simulados. El sistema usa softphones reales, AMI, CDR, grabaciones, Redis, PostgreSQL, MongoDB, Floci, AGI y circuit breaker.

El proyecto corre en:

```text
CALL_MODE=lab_internal
```

Eso significa que los clientes son extensiones internas `9001-9005`. No hay SIP trunk ni llamadas PSTN reales.

## Preparacion

```bash
docker compose up -d --build
./scripts/install-freepbx.sh
./scripts/create-demo-extensions.sh
./scripts/fix-lan-audio.sh
docker compose exec freepbx fwconsole reload
```

Abrir:

```text
Dashboard: http://localhost:5173
FreePBX:   http://localhost:8081/admin
Health:    http://localhost:3000/api/health
```

Login:

```text
admin / telefonia_admin_dev
```

## Demo A: llamada interna directa

1. Registrar dos softphones:
   - `1001 / Telefonia1001`
   - `1002 / Telefonia1002`
2. Desde `1001`, llamar a `1002`.
3. Contestar en `1002`.
4. Hablar unos segundos y cortar.
5. Revisar dashboard, CDR y grabacion.

Resultado esperado:

- La llamada pasa por FreePBX/Asterisk.
- El audio viaja por RTP real.
- AMI entrega eventos al backend.
- El dashboard actualiza el estado en tiempo real.
- El CDR queda registrado en FreePBX.
- Si hubo respuesta, la grabacion queda enlazada.

## Demo B: cliente simulado entra al IVR

1. Registrar un cliente simulado:
   - `9001 / Telefonia9001`
2. Registrar soporte:
   - `1001 / Telefonia1001`
3. Desde `9001`, llamar a `5000`.
4. Presionar `1` para soporte.
5. Debe timbrar la ruta `6000`: `1001`, `1002`, `1003`.
6. Contestar desde `1001`.
7. Cortar y revisar CDR/eventos/grabacion.

Resultado esperado:

- `9001` entra por el contexto `lab-clients`.
- El cliente puede llamar al IVR `5000`.
- El cliente no puede llamar directo al supervisor `4001`.
- La opcion `1` enruta a soporte.
- La llamada queda registrada por AMI/CDR igual que una llamada real.

## Marcador inteligente

1. En el dashboard, usar `Marcar lead`.
2. El softphone del agente `1001` debe timbrar.
3. Al contestar, Asterisk continua el flujo hacia un lead `9001-9005`.
4. Contestar en el softphone del cliente simulado y finalizar.

Que se demuestra:

- El dashboard no simula la llamada; llama al backend.
- El backend llama al microservicio `dialer-service`.
- El marcador toma un lead desde Redis.
- El marcador abre AMI `5038/tcp` dentro de Docker.
- AMI ejecuta `Originate`.
- Asterisk usa el contexto `sales-campaign`.
- El AGI Python queda integrado como punto de analisis.
- En `CALL_MODE=lab_internal`, el marcador bloquea destinos fuera de `9001-9005`.

## Analisis de calidad y oportunidad

1. Usar `Analizar texto demo`.
2. Revisar el panel de call center.
3. Verificar oportunidades, calidad promedio y datos enmascarados.

Resultado esperado:

- El backend llama a `transcription-service`.
- La transcripcion se guarda en MongoDB.
- El texto visible no conserva un numero completo de tarjeta.
- El texto original queda cifrado.
- El analizador detecta palabras comerciales como precio, demo y plan.

## Resiliencia

Desde el panel `Circuit breaker - proveedores`, forzar fallas en:

```text
PostgreSQL
Asterisk AMI
Floci SQS
Floci S3
Marcador Python
Transcripcion IA
Metricas Call Center
```

Tambien por terminal:

```bash
./scripts/demo-circuit-breaker.sh transcription
```

Resultado esperado:

- El circuito pasa a `OPEN`.
- El dashboard muestra el proveedor degradado.
- Al recuperar, vuelve a `CLOSED` si el servicio real responde.

## Seguridad

Mostrar:

- Login con token.
- AMI con usuario dedicado.
- AMI no publicado al host por defecto.
- Provisionador FreePBX protegido por token.
- PostgreSQL, Redis, MongoDB y Floci no publicados al host por defecto.
- Puertos de datos disponibles solo con `compose.dev-ports.yaml`.
- SIP/RTP publicados porque los softphones LAN los necesitan.
- PAN de tarjeta enmascarado en transcripcion visible.
- Original de transcripcion cifrado.
- Grabaciones vinculadas al CDR.
- Separacion de responsabilidades por redes Docker.
- Segmentacion por VLAN/subred documentada en `docs/VLAN_FIREWALL.md`.

Si el laboratorio se monta con VLANs reales:

```bash
./scripts/apply-lab-firewall.sh plan
ENTERPRISE_NET=10.10.10.0/24 CLIENT_NET=10.10.20.0/24 PBX_NET=10.10.30.0/24 PBX_HOST_IP=10.10.30.10 ./scripts/apply-lab-firewall.sh apply
```

Prueba esperada desde red Clientes:

```bash
nc -vz 10.10.30.10 8081
nc -vz 10.10.30.10 3000
```

Debe fallar porque Clientes no administra FreePBX ni dashboard. En Linphone, el mismo cliente si debe poder registrar SIP contra `10.10.30.10` y llamar al IVR `5000`.

## Evidencia final

```bash
./scripts/run-smoke-tests.sh
./scripts/demo-report.sh
```

El reporte queda en `reports/` e incluye:

- Estado de proveedores y circuit breakers.
- Llamadas recientes.
- CDR recientes y reconciliacion.
- Grabaciones.
- Evidencias S3.
- Auditoria.
- Estado de call center.
- Metricas de marcacion, transcripcion, oportunidades y enmascaramiento.

## Puntos que defender

- La llamada real ocurre por SIP/PJSIP contra FreePBX; no pasa por el backend.
- El backend observa Asterisk por AMI y no inventa estados.
- La Red Empresa y la Red Clientes Simulados se separan por contextos Asterisk.
- La separacion de red real se aplica con VLANs/subredes distintas y reglas nftables.
- El IVR `5000` y las rutas `6000/7000/8000` son dialplan real de laboratorio.
- El marcador Python controla llamadas por AMI `Originate`.
- Redis mantiene la cola y estado realtime de la campana.
- MongoDB conserva transcripciones y analisis.
- Floci representa servicios cloud locales para cola y evidencia.
- No hay SIP trunk ni PSTN real; eso queda documentado como evolucion futura.
- Docker separa voz, aplicacion, datos y cloud local por redes.
