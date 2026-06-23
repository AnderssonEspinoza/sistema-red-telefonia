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
    ['ext' => '1001', 'name' => 'Andersson Espinoza', 'secret' => 'Telefonia1001'],
    ['ext' => '1002', 'name' => 'Agente - Maria Lopez', 'secret' => 'Telefonia1002'],
    ['ext' => '1003', 'name' => 'Soporte 2 - Luis Torres', 'secret' => 'Telefonia1003'],
    ['ext' => '1004', 'name' => 'Agente - Sofia Ramos', 'secret' => 'Telefonia1004'],
    ['ext' => '1099', 'name' => 'Operador Web', 'secret' => 'Telefonia1099'],
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
        'max_contacts' => $item['ext'] === '1099' ? 1 : 2,
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

$db = FreePBX::Database();
applyNatAudioSettingsForAllExtensions($db);
applyLabContexts($db);
applyWebrtcSettings($db, '1099');

function upsertSipSetting(PDO $db, string $extension, string $keyword, string $value): void
{
    $stmt = $db->prepare(
        "INSERT INTO sip (id, keyword, data, flags) VALUES (?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE data = VALUES(data)"
    );
    $stmt->execute([$extension, $keyword, $value]);
}

function applyNatAudioSettingsForAllExtensions(PDO $db): void
{
    $settings = [
        'allow' => 'ulaw,alaw,gsm,g726,g722,h264,vp8',
        'direct_media' => 'no',
        'rtp_symmetric' => 'yes',
        'force_rport' => 'yes',
        'rewrite_contact' => 'yes',
        'media_encryption' => 'no',
        'qualify_frequency' => '0',
        'qualifyfreq' => '0',
    ];

    foreach ($settings as $keyword => $value) {
        $stmt = $db->prepare("UPDATE sip SET data = ? WHERE keyword = ?");
        $stmt->execute([$value, $keyword]);
    }
}

function applyLabContexts(PDO $db): void
{
    $enterprise = ['1001', '1002', '1003', '1004', '1099', '2001', '3001', '4001'];
    $clients = ['9001', '9002', '9003', '9004', '9005'];

    foreach ($enterprise as $extension) {
        upsertSipSetting($db, $extension, 'context', 'lab-enterprise');
    }

    foreach ($clients as $extension) {
        upsertSipSetting($db, $extension, 'context', 'lab-clients');
    }
}

function applyWebrtcSettings(PDO $db, string $extension): void
{
    $settings = [
        'allow' => 'ulaw,alaw,gsm,g726,g722,h264,vp8',
        'transport' => '0.0.0.0-ws',
        'webrtc' => 'yes',
        'media_encryption' => 'dtls',
        'dtls_auto_generate_cert' => 'yes',
        'dtls_setup' => 'actpass',
        'avpf' => 'yes',
        'use_avpf' => 'yes',
        'force_avp' => 'yes',
        'ice_support' => 'yes',
        'icesupport' => 'yes',
        'bundle' => 'yes',
        'rtcp_mux' => 'yes',
        'media_use_received_transport' => 'yes',
        'direct_media' => 'no',
        'rtp_symmetric' => 'yes',
        'force_rport' => 'yes',
        'rewrite_contact' => 'yes',
        'max_contacts' => '1',
        'remove_existing' => 'yes',
        'remove_unavailable' => 'yes',
        'qualify_frequency' => '0',
        'qualifyfreq' => '0',
    ];

    foreach ($settings as $keyword => $value) {
        upsertSipSetting($db, $extension, $keyword, $value);
    }
}
PHP

docker compose exec -T freepbx fwconsole reload
docker compose exec -T freepbx asterisk -rx 'pjsip show endpoints'
