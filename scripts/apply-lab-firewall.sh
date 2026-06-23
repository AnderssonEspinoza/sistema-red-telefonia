#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-plan}"
ENTERPRISE_NET="${ENTERPRISE_NET:-10.10.10.0/24}"
CLIENT_NET="${CLIENT_NET:-10.10.20.0/24}"
PBX_NET="${PBX_NET:-10.10.30.0/24}"
PBX_HOST_IP="${PBX_HOST_IP:-}"

if [[ "$ACTION" != "plan" && "$ACTION" != "apply" && "$ACTION" != "remove" ]]; then
  echo "Uso: $0 [plan|apply|remove]" >&2
  exit 1
fi

if ! command -v nft >/dev/null 2>&1; then
  echo "nftables no esta instalado. Instala nftables antes de aplicar firewall." >&2
  exit 1
fi

if [[ "$ACTION" == "remove" ]]; then
  sudo nft delete table inet callcenter_lab 2>/dev/null || true
  echo "Firewall callcenter_lab removido."
  exit 0
fi

if [[ -z "$PBX_HOST_IP" ]]; then
  PBX_HOST_IP="$(ip -4 route get 1.1.1.1 | awk '{for (i=1; i<=NF; i++) if ($i == "src") {print $(i+1); exit}}')"
fi

RULESET="$(mktemp)"
trap 'rm -f "$RULESET"' EXIT

cat > "$RULESET" <<EOF
table inet callcenter_lab {
  set enterprise_net {
    type ipv4_addr
    flags interval
    elements = { ${ENTERPRISE_NET} }
  }

  set client_net {
    type ipv4_addr
    flags interval
    elements = { ${CLIENT_NET} }
  }

  set pbx_net {
    type ipv4_addr
    flags interval
    elements = { ${PBX_NET} }
  }

  chain input {
    type filter hook input priority -100; policy accept;

    ct state established,related accept
    iifname "lo" accept

    # Clientes simulados: solo servicios de voz hacia la PBX.
    ip saddr @client_net ip daddr ${PBX_HOST_IP} udp dport 5060 accept
    ip saddr @client_net ip daddr ${PBX_HOST_IP} udp dport 10000-10100 accept
    ip saddr @client_net ip daddr ${PBX_HOST_IP} tcp dport 8088 accept

    # Clientes simulados no administran dashboard, FreePBX, AMI ni datos.
    ip saddr @client_net ip daddr ${PBX_HOST_IP} tcp dport { 3000, 5173, 8081, 8443, 5038, 5432, 6379, 27017, 4566 } drop

    # Empresa: puede operar dashboard y administrar FreePBX local.
    ip saddr @enterprise_net ip daddr ${PBX_HOST_IP} tcp dport { 3000, 5173, 8081, 8443, 8088 } accept
    ip saddr @enterprise_net ip daddr ${PBX_HOST_IP} udp dport { 5060, 10000-10100 } accept

    # AMI y bases de datos no se exponen a redes externas del laboratorio.
    ip saddr != 127.0.0.1 ip daddr ${PBX_HOST_IP} tcp dport { 5038, 5432, 6379, 27017, 4566 } drop
  }

  chain forward {
    type filter hook forward priority -100; policy accept;

    ct state established,related accept

    # Clientes no deben entrar a redes de datos/aplicacion.
    ip saddr @client_net ip daddr @pbx_net udp dport { 5060, 10000-10100 } accept
    ip saddr @client_net ip daddr @enterprise_net drop

    # Empresa puede hablar con PBX, pero no con red de clientes salvo via PBX.
    ip saddr @enterprise_net ip daddr @client_net drop
  }
}
EOF

if [[ "$ACTION" == "plan" ]]; then
  cat "$RULESET"
  echo
  echo "Plan generado. Para aplicar:"
  echo "ENTERPRISE_NET=${ENTERPRISE_NET} CLIENT_NET=${CLIENT_NET} PBX_NET=${PBX_NET} PBX_HOST_IP=${PBX_HOST_IP} $0 apply"
  exit 0
fi

sudo nft delete table inet callcenter_lab 2>/dev/null || true
sudo nft -f "$RULESET"
echo "Firewall callcenter_lab aplicado para PBX ${PBX_HOST_IP}."
