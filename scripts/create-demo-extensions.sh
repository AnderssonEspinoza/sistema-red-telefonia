#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

docker compose up -d freepbx

until docker compose exec -T freepbx asterisk -rx 'core show version' >/dev/null 2>&1; do
  sleep 3
done

docker compose exec -T freepbx php <<'PHP'
<?php
include "/etc/freepbx.conf";

$core = FreePBX::Core();
$extensions = [
    ['ext' => '1001', 'name' => 'Juan Perez', 'secret' => 'Telefonia1001'],
    ['ext' => '1002', 'name' => 'Maria Lopez', 'secret' => 'Telefonia1002'],
];

foreach ($extensions as $item) {
    if ($core->getDevice($item['ext']) || $core->getUser($item['ext'])) {
        echo "Extension {$item['ext']} ya existe\n";
        continue;
    }

    $result = $core->processQuickCreate('pjsip', $item['ext'], [
        'name' => $item['name'],
        'secret' => $item['secret'],
        'outboundcid' => '',
        'password' => '',
        'max_contacts' => 2,
        'vm' => 'no',
        'vmpwd' => '',
        'email' => '',
    ]);

    echo json_encode($result, JSON_UNESCAPED_SLASHES) . "\n";
}
PHP

docker compose exec -T freepbx fwconsole reload
docker compose exec -T freepbx asterisk -rx 'pjsip show endpoints'
