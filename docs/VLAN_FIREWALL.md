# VLANs, subredes y firewall del laboratorio

Este documento describe la segmentacion real esperada para el laboratorio de telefonia IP. La separacion de extensiones en Asterisk ya existe, pero la separacion de red se logra cuando los equipos estan en VLANs o subredes diferentes y el host de la PBX aplica reglas de firewall.

## Segmentos

| Segmento | VLAN sugerida | Subred sugerida | Ejemplos |
| --- | --- | --- | --- |
| Empresa / Call Center | 10 | `10.10.10.0/24` | Agentes, soporte, marketing, ventas, supervisor |
| Clientes simulados | 20 | `10.10.20.0/24` | Celulares o PCs registrados como `9001-9005` |
| PBX / Voz | 30 | `10.10.30.0/24` | Laptop o servidor donde corre FreePBX/Asterisk |
| Aplicacion | 40 | `10.10.40.0/24` | Dashboard, backend, microservicios |
| Datos | 50 | `10.10.50.0/24` | PostgreSQL, Redis, MongoDB, MariaDB |

En Docker tambien se separan redes internas:

| Red Docker | Subred Docker | Uso |
| --- | --- | --- |
| `voice_net` | `172.30.10.0/24` | FreePBX/Asterisk y servicios que hablan AMI/SIP |
| `app_net` | `172.30.20.0/24` | Frontend, backend y microservicios |
| `data_net` | `172.30.30.0/24` | Bases de datos, red interna |
| `local_cloud_net` | `172.30.40.0/24` | Floci SQS/S3 local |

La separacion Docker protege contenedores. La separacion VLAN/subred protege dispositivos reales como celulares con Linphone.

## Reglas de firewall

Reglas esperadas:

- Clientes simulados pueden llegar a la PBX solo por voz: `5060/udp`, `10000-10100/udp` y `8088/tcp`.
- Clientes simulados no pueden abrir dashboard, FreePBX admin, AMI ni bases de datos.
- Empresa puede usar dashboard, FreePBX admin y telefonia.
- Empresa y Clientes no se comunican directo entre ellos; la comunicacion de llamadas pasa por Asterisk.
- Las bases de datos no se publican hacia Empresa ni Clientes.

El bloqueo por extension tambien existe en Asterisk:

- Clientes `9001-9005` pueden llamar al IVR `5000`.
- Clientes no pueden llamar directo al supervisor `4001`.
- Empresa puede llamar a clientes `9001-9005`.

## Aplicar reglas en Linux

Primero revisa que subred tiene cada segmento. Si usas otras redes, cambialas en las variables:

```bash
./scripts/apply-lab-firewall.sh plan
```

Ejemplo aplicando el diseno sugerido:

```bash
ENTERPRISE_NET=10.10.10.0/24 \
CLIENT_NET=10.10.20.0/24 \
PBX_NET=10.10.30.0/24 \
PBX_HOST_IP=10.10.30.10 \
./scripts/apply-lab-firewall.sh apply
```

Para retirar las reglas:

```bash
./scripts/apply-lab-firewall.sh remove
```

## Pruebas de segmentacion

Desde un equipo de Clientes:

```bash
nc -vz <ip-pbx> 8081
nc -vz <ip-pbx> 3000
```

Esas pruebas deben fallar. El cliente no debe administrar FreePBX ni dashboard.

Desde un equipo de Empresa:

```bash
nc -vz <ip-pbx> 8081
nc -vz <ip-pbx> 3000
```

Esas pruebas deben responder, porque Empresa si opera el sistema.

Desde Linphone en Clientes:

- Usuario: `9001`
- Dominio/servidor SIP: IP de la PBX, por ejemplo `10.10.30.10`
- Transporte: UDP
- Llamar a `5000`

Debe entrar al IVR. Si intenta llamar directo a `4001`, Asterisk debe bloquearlo por contexto `lab-clients`.

Desde Linphone en Empresa:

- Usuario: `1001`
- Dominio/servidor SIP: IP de la PBX
- Llamar a `9001`, `5000`, `6000`, `7000` o `8000`

Debe funcionar segun la ruta configurada.

## Limitacion importante

Si todos los celulares estan conectados a la misma WiFi y reciben IPs de la misma red, por ejemplo `192.168.1.0/24`, no hay segmentacion real entre Empresa y Clientes. En ese caso Asterisk sigue separando permisos por extension, pero la red fisica no esta separada.

Para que sea real se necesita una de estas opciones:

- Router/AP con VLANs y dos SSID: uno para Empresa y otro para Clientes.
- Router con varias subredes LAN.
- Dos redes fisicas separadas.
- Una VM/router de laboratorio que enrute entre subredes y aplique firewall.

