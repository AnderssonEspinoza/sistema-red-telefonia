#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LAN_IP="${1:-$(ip -4 route get 1.1.1.1 | awk '{for (i=1; i<=NF; i++) if ($i == "src") {print $(i+1); exit}}')}"
LAN_IFACE="$(ip -4 route get 1.1.1.1 | awk '{for (i=1; i<=NF; i++) if ($i == "dev") {print $(i+1); exit}}')"
LAN_ROUTE="$(ip -4 route show dev "$LAN_IFACE" proto kernel scope link | awk -v ip="$LAN_IP" '$0 ~ "src " ip {print $1; exit}')"
LAN_NET="${LAN_ROUTE%/*}"
LAN_CIDR="${LAN_ROUTE#*/}"

if [[ -z "$LAN_IP" || -z "$LAN_NET" || -z "$LAN_CIDR" || "$LAN_NET" == "$LAN_CIDR" ]]; then
  echo "No se pudo detectar la red LAN automaticamente." >&2
  echo "Uso: $0 <ip-lan>" >&2
  exit 1
fi

docker compose up -d freepbx

until docker compose exec -T freepbx asterisk -rx 'core show version' >/dev/null 2>&1; do
  sleep 3
done

docker compose exec -T \
  -e LAN_IP="$LAN_IP" \
  -e LAN_NET="$LAN_NET" \
  -e LAN_CIDR="$LAN_CIDR" \
  freepbx php <<'PHP'
<?php
include "/etc/freepbx.conf";

$lanIp = getenv('LAN_IP');
$lanNet = getenv('LAN_NET');
$lanCidr = getenv('LAN_CIDR');

$sipsettings = FreePBX::Sipsettings();
$sipsettings->setConfig('externip', $lanIp);
$sipsettings->setConfig('localnets', [
    ['net' => $lanNet, 'mask' => $lanCidr],
]);
$sipsettings->setConfig('rtpstart', '10000');
$sipsettings->setConfig('rtpend', '10100');

$db = FreePBX::Database();
$stmt = $db->prepare("UPDATE sip SET data = 'no' WHERE keyword = 'direct_media' AND id IN ('1001', '1002')");
$stmt->execute();

echo "SIP external address: {$lanIp}\n";
echo "SIP local network: {$lanNet}/{$lanCidr}\n";
echo "RTP range: 10000-10100\n";
echo "Direct media: disabled for 1001 and 1002\n";
PHP

docker compose exec -T freepbx fwconsole reload
docker compose stop freepbx
docker compose run --rm --no-deps --entrypoint sh freepbx -c 'rm -f /var/run/apache2/apache2.pid /run/apache2/apache2.pid /var/run/httpd/httpd.pid /run/httpd/httpd.pid /var/lock/apache2/* 2>/dev/null || true'
docker compose up -d --force-recreate freepbx

until docker compose exec -T freepbx asterisk -rx 'core show version' >/dev/null 2>&1; do
  sleep 3
done

sleep 10
docker compose exec -T freepbx fwconsole reload
docker compose exec -T freepbx asterisk -rx 'pjsip show transports'
docker compose exec -T freepbx asterisk -rx 'rtp show settings'
