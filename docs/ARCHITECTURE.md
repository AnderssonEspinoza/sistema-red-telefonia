# Arquitectura

## Vista general

El sistema es un laboratorio de call center VoIP privado. Mantiene una sola PBX central con FreePBX/Asterisk y separa logicamente dos grupos de extensiones:

- Red Empresa: agentes, soporte, marketing, ventas y supervisor.
- Red Clientes Simulados: clientes internos usados como leads de laboratorio.

No hay SIP trunk ni llamadas PSTN reales. Las llamadas ocurren entre softphones registrados contra Asterisk.

```text
                         Red Empresa
        1001 Soporte   1002 Agente   1003 Soporte 2
        1004 Agente    2001 Marketing
        3001 Ventas    4001 Supervisor
                              |
                              | SIP/RTP
                              v
+-----------------------------+-----------------------------+
|                         PBX Central                       |
|                    FreePBX / Asterisk                     |
|                                                           |
|  Contextos:                                                |
|  - lab-enterprise                                          |
|  - lab-clients                                             |
|  - callcenter-ivr    5000                                  |
|  - callcenter-queues 6000/7000/8000                        |
|  - sales-campaign                                          |
|                                                           |
|  AMI + CDR + grabaciones + AGI sales_quality_agi.py        |
+-----------------------------+-----------------------------+
                              ^
                              | SIP/RTP
                Red Clientes Simulados
        9001 Carlos       9002 Maria
        9003 Empresa Demo 9004 Reclamo 9005 Interesado

        Dashboard React
              |
              v
        Backend Node/Express ---- AMI listener / API / reportes
          |       |       |
          |       |       +---- Floci SQS/S3 local
          |       +------------ PostgreSQL: usuarios, llamadas, auditoria
          +-------------------- Microservicios Python
                                - dialer-service -> Redis + AMI
                                - transcription-service -> MongoDB
                                - metrics-service -> Redis + MongoDB
```

## Reglas de llamadas

| Origen | Permitido | Bloqueado |
| --- | --- | --- |
| Empresa `1001-1004`, `1099`, `2001`, `3001`, `4001` | Extensiones internas, clientes `9001-9005`, IVR `5000`, colas `6000/7000/8000` | PSTN, porque no hay trunk real |
| Clientes `9001-9005` | IVR principal `5000` | Supervisor `4001` directo y llamadas directas a extensiones internas |
| Marcador `sales-campaign` | Leads internos `9001-9005` | Numeros externos en `CALL_MODE=lab_internal` |

## IVR y colas de laboratorio

La extension `5000` entra al IVR principal:

- `1`: Soporte, ruta `6000`, timbra `1001`, `1002`, `1003`.
- `2`: Ventas, ruta `7000`, timbra `3001`.
- `3`: Marketing, ruta `8000`, timbra `2001`.
- `0`: Recepcion, timbra `1001`.

Las rutas `6000`, `7000` y `8000` son colas livianas implementadas con `Dial()` en `extensions_custom.conf`. Para produccion se pueden reemplazar por colas FreePBX reales con estrategia, musica en espera, miembros dinamicos y metricas de cola.

## Componentes reales

- Registro SIP/PJSIP real contra Asterisk.
- Audio/video RTP real entre softphones y PBX.
- AMI real para eventos y `Originate`.
- CDR y grabaciones reales generadas por Asterisk/FreePBX.
- Redis real para leads y estado de campana.
- PostgreSQL real para usuarios, llamadas, auditoria y eventos.
- MongoDB real para transcripciones.
- Floci local para simular SQS/S3 sin depender de nube externa.

## Componentes simulados

- Clientes `9001-9005`: son softphones internos, no telefonos PSTN.
- Numeros externos: no se marcan en el laboratorio.
- SIP trunk: documentado como evolucion futura, no implementado.

## Redes Docker

- `voice_net`: FreePBX/Asterisk y servicios que necesitan telefonia.
- `app_net`: frontend, backend y microservicios.
- `data_net`: PostgreSQL, Redis, MongoDB y MariaDB de FreePBX. Es interna.
- `local_cloud_net`: Floci SQS/S3 local.

Puertos publicados por defecto:

- `5173/tcp`: dashboard.
- `3000/tcp`: backend.
- `8081/tcp`, `8443/tcp`: FreePBX web.
- `8088/tcp`, `8089/tcp`: Asterisk HTTP/WebSocket SIP para telefono web.
- `5060/udp`: SIP/PJSIP para softphones LAN.
- `10000-10100/udp`: RTP.

PostgreSQL, Redis, MongoDB, Floci y AMI no se publican al host por defecto. Para depuracion local se puede usar:

```bash
docker compose -f compose.yaml -f compose.dev-ports.yaml up -d
```

## Segmentacion por VLAN/subred

La separacion fisica requiere infraestructura de red: router/switch/AP con VLANs o, al menos, subredes distintas con reglas de firewall. Docker no puede separar por VLAN a celulares conectados a la misma WiFi si el router los deja en la misma LAN.

Diseno objetivo:

| Segmento | VLAN sugerida | Subred sugerida | Uso |
| --- | --- | --- | --- |
| Empresa | 10 | `10.10.10.0/24` | Agentes, soporte, marketing, ventas, supervisores |
| Clientes simulados | 20 | `10.10.20.0/24` | Softphones de clientes `9001-9005` |
| PBX/Voz | 30 | `10.10.30.0/24` | Host FreePBX/Asterisk, SIP y RTP |
| Aplicacion | 40 | `10.10.40.0/24` | Backend, frontend y microservicios |
| Datos | 50 | `10.10.50.0/24` | PostgreSQL, Redis, MongoDB, MariaDB FreePBX |

Reglas firewall esperadas:

- Clientes simulados pueden llegar a PBX por `5060/udp`, `10000-10100/udp` y `8088/tcp`.
- Clientes simulados no acceden a dashboard, FreePBX admin, AMI ni bases de datos.
- Empresa puede operar dashboard y FreePBX admin.
- Empresa no habla directo con Clientes; las llamadas deben pasar por PBX.
- Datos no se publican a Empresa ni Clientes.
- El bloqueo de `9001-9005` hacia supervisor `4001` lo aplica Asterisk en `lab-clients`, porque esa regla depende del numero marcado dentro del protocolo SIP.

El repositorio incluye un firewall base para Linux/nftables:

```bash
./scripts/apply-lab-firewall.sh plan
ENTERPRISE_NET=10.10.10.0/24 CLIENT_NET=10.10.20.0/24 PBX_NET=10.10.30.0/24 PBX_HOST_IP=<ip-pbx> ./scripts/apply-lab-firewall.sh apply
```

Para retirar esas reglas:

```bash
./scripts/apply-lab-firewall.sh remove
```

La conexion a PSTN se haria mediante un SIP trunk real, con reglas de costos, rutas inbound/outbound, caller ID autorizado y cumplimiento legal.
