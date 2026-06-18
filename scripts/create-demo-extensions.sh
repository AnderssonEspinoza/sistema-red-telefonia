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
    ['ext' => '1001', 'name' => 'Soporte - Juan Perez', 'secret' => 'Telefonia1001'],
    ['ext' => '1002', 'name' => 'Agente - Maria Lopez', 'secret' => 'Telefonia1002'],
    ['ext' => '2001', 'name' => 'Marketing - Campanas', 'secret' => 'Telefonia2001'],
    ['ext' => '3001', 'name' => 'Ventas - Asesor', 'secret' => 'Telefonia3001'],
    ['ext' => '4001', 'name' => 'Supervisor - Call Center', 'secret' => 'Telefonia4001'],
    ['ext' => '9001', 'name' => 'Cliente Carlos', 'secret' => 'Telefonia9001'],
    ['ext' => '9002', 'name' => 'Cliente Maria', 'secret' => 'Telefonia9002'],
    ['ext' => '9003', 'name' => 'Cliente Empresa Demo', 'secret' => 'Telefonia9003'],
    ['ext' => '9004', 'name' => 'Cliente Reclamo', 'secret' => 'Telefonia9004'],
    ['ext' => '9005', 'name' => 'Cliente Interesado', 'secret' => 'Telefonia9005'],
];

foreach ($extensions as $item) {
    $device = $core->getDevice($item['ext']);
    $user = $core->getUser($item['ext']);
    $wasPartial = (bool)(($device && !$user) || (!$device && $user));

    if ($wasPartial) {
        echo "Extension {$item['ext']} parcial, reparando\n";
        if ($device) {
            $core->delDevice($item['ext']);
        }
        if ($user) {
            $core->delUser($item['ext']);
        }
        $device = null;
        $user = null;
    }

    if ($device && $user) {
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
    try {
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
    } catch (Throwable $error) {
        echo "No se pudo aplicar grabacion en {$extension}: {$error->getMessage()}\n";
    }
}

$settings = [
    'direct_media' => 'no',
    'rtp_symmetric' => 'yes',
    'force_rport' => 'yes',
    'rewrite_contact' => 'yes',
    'media_encryption' => 'no',
];
$db = FreePBX::Database();
foreach ($settings as $keyword => $value) {
    $stmt = $db->prepare("UPDATE sip SET data = ? WHERE keyword = ?");
    $stmt->execute([$value, $keyword]);
}
PHP

docker compose exec -T freepbx fwconsole reload
docker compose exec -T freepbx asterisk -rx 'pjsip show endpoints'
