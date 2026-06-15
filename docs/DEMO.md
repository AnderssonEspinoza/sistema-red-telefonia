# Guion de Demo

## Objetivo

Demostrar un call center de ventas sobre telefonia IP con Asterisk/FreePBX, marcador inteligente, analisis de calidad, persistencia, observabilidad, resiliencia y controles de seguridad.

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

## 1. Validacion de telefonia real

1. Registrar dos softphones:
   - `1001 / Telefonia1001`
   - `1002 / Telefonia1002`
2. Llamar manualmente de `1001` a `1002`.
3. Contestar y cortar.

Resultado esperado:

- La llamada pasa por FreePBX/Asterisk.
- AMI entrega eventos al backend.
- La tabla de llamadas se actualiza en tiempo real.
- El CDR de Asterisk aparece en reconciliacion.
- Si hubo respuesta, la grabacion queda enlazada al CDR.
- Floci S3 guarda evidencia JSON por evento procesado.

## 2. Marcador inteligente

1. En el dashboard, usar `Marcar lead`.
2. El softphone del agente `1001` debe timbrar.
3. Al contestar, Asterisk continua el flujo hacia el lead `1002`.
4. Contestar en `1002` y finalizar.

Que se esta demostrando:

- El dashboard no simula la llamada; llama al backend.
- El backend llama al microservicio `dialer-service`.
- El marcador toma un lead desde Redis.
- El marcador abre AMI `5038/tcp` y ejecuta `Originate`.
- Asterisk usa el contexto `sales-campaign`.
- El AGI Python queda integrado en el dialplan para analisis.

## 3. Analisis de calidad y oportunidad

1. Usar `Analizar texto demo`.
2. Revisar el panel `Call center - ventas y calidad`.
3. Verificar que suban oportunidades, calidad promedio y datos enmascarados.

Resultado esperado:

- El backend llama a `transcription-service`.
- La transcripcion se guarda en MongoDB.
- El texto visible no conserva el numero completo de tarjeta.
- El texto original queda cifrado.
- El analizador detecta palabras comerciales como precio, demo y plan.

## 4. Resiliencia

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

## 5. Seguridad

Mostrar:

- Login con token.
- AMI con usuario dedicado.
- Provisionador FreePBX protegido por token.
- Microservicios internos sin puertos expuestos al host.
- PAN de tarjeta enmascarado en transcripcion visible.
- Original de transcripcion cifrado en MongoDB.
- Grabaciones vinculadas al CDR.
- Separacion de responsabilidades por contenedores.

## 6. Evidencia final

```bash
./scripts/run-smoke-tests.sh
./scripts/demo-report.sh
```

El reporte queda en `reports/demo-*.json` e incluye:

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
- El marcador Python controla llamadas por AMI `Originate`.
- Redis mantiene la cola y estado realtime de la campana.
- MongoDB conserva transcripciones y analisis.
- El enmascaramiento evita guardar visible un numero de tarjeta completo.
- Floci representa servicios cloud locales para cola y evidencia.
- El circuit breaker evita que una falla de proveedor bloquee todo el sistema.
- Docker separa componentes; en una red real se llevaria a VLAN de voz, VLAN de aplicacion y VLAN de datos.
