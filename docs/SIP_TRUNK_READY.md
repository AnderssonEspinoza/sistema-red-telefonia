# Preparacion Para SIP Trunk

El sistema queda en modo laboratorio con:

```text
CALL_MODE=lab_internal
```

En este modo los leads son extensiones internas `9001-9005`. No se permite marcar numeros externos reales desde el marcador.

## Modo futuro

Existe el nombre reservado:

```text
CALL_MODE=sip_trunk_ready
```

Ese modo no conecta ningun proveedor real. Solo documenta lo que faltaria para pasar de laboratorio a produccion.

## Que haria falta para produccion

- Proveedor SIP trunk contratado.
- DID o numero de entrada asignado por el proveedor.
- Credenciales SIP del trunk.
- Ruta inbound hacia IVR, cola o recepcion.
- Rutas outbound con prefijos permitidos.
- Caller ID autorizado por el proveedor.
- Limites de costo y concurrencia.
- Bloqueo de destinos caros o no permitidos.
- Grabacion y retencion segun norma aplicable.
- Politica de consentimiento si se graban llamadas.
- Firewall/VLAN para separar voz, aplicaciones y datos.
- Monitoreo de CDR, ASR, ACD, perdida RTP, jitter y disponibilidad.

## Lo que no debe hacerse en el laboratorio

- No poner credenciales reales de proveedor en el repositorio.
- No publicar AMI a internet.
- No abrir Redis, MongoDB o PostgreSQL a redes no confiables.
- No permitir marcacion externa sin reglas de costo y cumplimiento.
- No confundir Tailscale o VPN con un SIP trunk: una VPN conecta dispositivos privados, no entrega salida PSTN.
