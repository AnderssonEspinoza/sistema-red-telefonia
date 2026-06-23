# Pruebas Remotas Con Tailscale

Tailscale permite probar softphones remotos como si estuvieran en una red privada. No reemplaza un SIP trunk y no permite llamar a celulares reales por si solo.

## Escenario

- PBX en una laptop o servidor con Docker.
- Agente con softphone en otra laptop o celular.
- Cliente simulado con softphone en otra laptop o celular.
- Todos conectados a la misma tailnet.

Los softphones deben apuntar a la IP Tailscale del servidor donde corre FreePBX/Asterisk.

```text
Servidor SIP: <IP_TAILSCALE_DEL_SERVIDOR_PBX>
Puerto SIP: 5060 UDP
RTP: 10000-10100 UDP
```

## Puertos necesarios

- `5060/udp`: registro y senalizacion SIP.
- `10000-10100/udp`: audio/video RTP.
- `8081/tcp`: FreePBX web, solo si se administra remotamente.
- `5173/tcp`: dashboard, solo si se opera remotamente.

AMI `5038/tcp`, Redis, MongoDB y PostgreSQL no deben abrirse a otros equipos salvo depuracion controlada.

## Checklist

En el servidor PBX:

```bash
tailscale status
tailscale ip -4
docker compose ps
```

En cada equipo remoto:

```bash
ping <IP_TAILSCALE_DEL_SERVIDOR_PBX>
```

Registrar softphones:

```text
Agente:
  Usuario: 1001
  Password: Telefonia1001
  Dominio: <IP_TAILSCALE_DEL_SERVIDOR_PBX>

Cliente:
  Usuario: 9001
  Password: Telefonia9001
  Dominio: <IP_TAILSCALE_DEL_SERVIDOR_PBX>
```

Pruebas:

1. `1001` llama a `9001`.
2. `9001` llama a `5000`.
3. En el IVR, presionar `1`.
4. Debe timbrar soporte `1001/1002/1003`.
5. Validar audio bidireccional.
6. Revisar dashboard, AMI/CDR y grabaciones.

## Ajuste de IP

Si se prueba por Tailscale, la IP que deben usar los softphones es la IP Tailscale del servidor PBX. Si se prueba por WiFi local, usan la IP LAN del servidor PBX.

El script:

```bash
./scripts/fix-lan-audio.sh <IP_DEL_SERVIDOR_PBX>
```

actualiza la IP que Asterisk anuncia para SIP/RTP.
