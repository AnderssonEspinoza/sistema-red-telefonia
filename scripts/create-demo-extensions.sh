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
        applyRecordingSettings($item['ext']);
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
        'recording_in_internal' => 'always',
        'recording_out_internal' => 'always',
        'recording_in_external' => 'always',
        'recording_out_external' => 'always',
        'recording_ondemand' => 'disabled',
        'recording_priority' => '10',
    ]);

    applyRecordingSettings($item['ext']);
    echo json_encode($result, JSON_UNESCAPED_SLASHES) . "\n";
}

function applyRecordingSettings(string $extension): void
{
    $astman = FreePBX::astman();
    $settings = [
        'recording/in/internal' => 'always',
        'recording/out/internal' => 'always',
        'recording/in/external' => 'always',
        'recording/out/external' => 'always',
        'recording/ondemand' => 'disabled',
        'recording/priority' => '10',
    ];

    foreach ($settings as $key => $value) {
        $astman->database_put('AMPUSER', $extension . '/' . $key, $value);
    }
}
PHP

docker compose exec -T freepbx fwconsole reload
docker compose exec -T freepbx asterisk -rx 'pjsip show endpoints'
