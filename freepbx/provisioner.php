<?php
declare(strict_types=1);

if (PHP_SAPI === 'cli') {
    runCliWorker($argv);
    exit;
}

runHttpEndpoint();

function runHttpEndpoint(): void
{
    header('Content-Type: application/json');

    $expectedToken = getenv('FREEPBX_PROVISIONER_TOKEN') ?: 'telefonia_provisioner_dev';
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $headerToken = $_SERVER['HTTP_X_PROVISIONER_TOKEN'] ?? '';

    if ($authorization === '' && function_exists('getallheaders')) {
        $headers = getallheaders();
        $authorization = $headers['Authorization'] ?? $headers['authorization'] ?? '';
        $headerToken = $headers['X-Provisioner-Token'] ?? $headers['x-provisioner-token'] ?? $headerToken;
    }

    if (!hash_equals('Bearer ' . $expectedToken, $authorization) && !hash_equals($expectedToken, $headerToken)) {
        jsonResponse(['ok' => false, 'error' => 'No autorizado'], 401);
        return;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        jsonResponse(provisionerStatus());
        return;
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonResponse(['ok' => false, 'error' => 'Metodo no permitido'], 405);
        return;
    }

    $payload = json_decode(file_get_contents('php://input') ?: '{}', true);

    if (!is_array($payload)) {
        jsonResponse(['ok' => false, 'error' => 'JSON invalido'], 400);
        return;
    }

    $action = (string)($payload['action'] ?? 'provision-extension');
    $validated = $action === 'configure-network' ? validateNetworkPayload($payload) : validatePayload($payload);

    if (isset($validated['error'])) {
        jsonResponse(['ok' => false, 'error' => $validated['error']], 400);
        return;
    }

    $tmpFile = tempnam(sys_get_temp_dir(), 'freepbx-provision-');

    if ($tmpFile === false) {
        jsonResponse(['ok' => false, 'error' => 'No se pudo preparar provisionamiento'], 500);
        return;
    }

    file_put_contents($tmpFile, json_encode($validated, JSON_UNESCAPED_SLASHES));

    $output = [];
    $code = 0;
    exec('php ' . escapeshellarg(__FILE__) . ' ' . escapeshellarg($tmpFile) . ' 2>&1', $output, $code);
    @unlink($tmpFile);

    $body = json_decode(implode("\n", $output), true);

    if ($code !== 0 || !is_array($body)) {
        jsonResponse(['ok' => false, 'error' => implode("\n", $output) ?: 'Provisionamiento fallido'], 500);
        return;
    }

    jsonResponse($body, ($body['ok'] ?? false) ? 200 : 500);
}

function runCliWorker(array $argv): void
{
    global $amp_conf;

    $payloadFile = $argv[1] ?? '';
    $payload = json_decode(@file_get_contents($payloadFile) ?: '{}', true);

    if (!is_array($payload)) {
        echo json_encode(['ok' => false, 'error' => 'Payload CLI invalido']);
        exit(1);
    }

    try {
        include '/etc/freepbx.conf';

        if (($payload['action'] ?? '') === 'configure-network') {
            configureNetwork($payload);
            return;
        }

        $core = FreePBX::Core();
        $extension = (string)$payload['extension'];
        $device = $core->getDevice($extension);
        $user = $core->getUser($extension);
        $wasPartial = (bool)(($device && !$user) || (!$device && $user));

        if ($wasPartial) {
            if ($device) {
                $core->delDevice($extension);
            }

            if ($user) {
                $core->delUser($extension);
            }

            $device = null;
            $user = null;
        }

        $exists = (bool)($device && $user);
        $created = false;

        if (!$exists) {
            $mode = $payload['recording'] ? 'always' : 'dontcare';
            $result = $core->processQuickCreate('pjsip', $extension, [
                'name' => (string)$payload['name'],
                'secret' => (string)$payload['secret'],
                'outboundcid' => '',
                'password' => '',
                'max_contacts' => $extension === '1099' ? 1 : 2,
                'vm' => 'no',
                'vmpwd' => '',
                'email' => '',
                'recording_in_internal' => $mode,
                'recording_out_internal' => $mode,
                'recording_in_external' => $mode,
                'recording_out_external' => $mode,
                'recording_ondemand' => 'disabled',
                'recording_priority' => '10',
            ]);

            if ($result === false) {
                throw new RuntimeException('FreePBX no pudo crear la extension');
            }

            $created = true;
        }

        applyNatAudioSettings($extension);
        applyLabContext($extension);
        applyRecordingSettings($extension, (bool)$payload['recording']);

        $reloadOutput = [];
        $reloadCode = 0;
        exec('fwconsole reload 2>&1', $reloadOutput, $reloadCode);

        echo json_encode([
            'ok' => true,
            'created' => $created,
            'exists' => $exists,
            'repaired' => $wasPartial,
            'extension' => $extension,
            'reload' => $reloadCode === 0,
            'message' => $created ? 'Extension creada en FreePBX' : 'Extension existente en FreePBX',
        ], JSON_UNESCAPED_SLASHES);
    } catch (Throwable $error) {
        echo json_encode(['ok' => false, 'error' => $error->getMessage()]);
        exit(1);
    }
}

function provisionerStatus(): array
{
    $transport = parseKeyValueFile('/etc/asterisk/pjsip.transports.conf');
    $rtp = parseKeyValueFile('/etc/asterisk/rtp_additional.conf');
    $localNet = $transport['local_net'] ?? null;

    return [
        'ok' => true,
        'service' => 'freepbx-provisioner',
        'version' => '1.2',
        'network' => [
            'externip' => $transport['external_media_address'] ?? $transport['external_signaling_address'] ?? null,
            'localnets' => $localNet ? [$localNet] : [],
            'rtpstart' => $rtp['rtpstart'] ?? null,
            'rtpend' => $rtp['rtpend'] ?? null,
        ],
    ];
}

function parseKeyValueFile(string $path): array
{
    $values = [];
    $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];

    foreach ($lines as $line) {
        $line = trim($line);

        if ($line === '' || str_starts_with($line, ';') || !str_contains($line, '=')) {
            continue;
        }

        [$key, $value] = array_map('trim', explode('=', $line, 2));
        $values[$key] = $value;
    }

    return $values;
}

function validateNetworkPayload(array $payload): array
{
    $lanIp = trim((string)($payload['lanIp'] ?? ''));
    $lanNet = trim((string)($payload['lanNet'] ?? ''));
    $lanCidr = (int)($payload['lanCidr'] ?? 0);

    if (!filter_var($lanIp, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        return ['error' => 'IP LAN invalida'];
    }

    if (!filter_var($lanNet, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        return ['error' => 'Red LAN invalida'];
    }

    if ($lanCidr < 8 || $lanCidr > 30) {
        return ['error' => 'CIDR invalido'];
    }

    return [
        'action' => 'configure-network',
        'lanIp' => $lanIp,
        'lanNet' => $lanNet,
        'lanCidr' => $lanCidr,
    ];
}

function configureNetwork(array $payload): void
{
    $lanIp = (string)$payload['lanIp'];
    $lanNet = (string)$payload['lanNet'];
    $lanCidr = (string)$payload['lanCidr'];

    $sipsettings = FreePBX::Sipsettings();
    $sipsettings->setConfig('externip', $lanIp);
    $sipsettings->setConfig('localnets', [
        ['net' => $lanNet, 'mask' => $lanCidr],
    ]);
    $sipsettings->setConfig('rtpstart', '10000');
    $sipsettings->setConfig('rtpend', '10100');

    applyNatAudioSettingsForAllExtensions();
    applyLabContextsForKnownExtensions();

    $reloadOutput = [];
    $reloadCode = 0;
    exec('fwconsole reload 2>&1', $reloadOutput, $reloadCode);

    echo json_encode([
        'ok' => true,
        'lanIp' => $lanIp,
        'lanNet' => $lanNet,
        'lanCidr' => (int)$lanCidr,
        'rtpStart' => 10000,
        'rtpEnd' => 10100,
        'reload' => $reloadCode === 0,
        'reloadOutput' => implode("\n", $reloadOutput),
        'message' => 'Red SIP/RTP actualizada en FreePBX',
    ], JSON_UNESCAPED_SLASHES);
}

function validatePayload(array $payload): array
{
    $extension = trim((string)($payload['extension'] ?? ''));
    $name = trim((string)($payload['name'] ?? ''));
    $secret = trim((string)($payload['secret'] ?? ''));
    $recording = filter_var($payload['recording'] ?? true, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
    $recording = $recording ?? true;

    if (!preg_match('/^\d{2,10}$/', $extension)) {
        return ['error' => 'Extension invalida'];
    }

    if ($name === '' || strlen($name) > 100) {
        return ['error' => 'Nombre invalido'];
    }

    if (!preg_match('/^[A-Za-z0-9_.@#-]{8,80}$/', $secret)) {
        return ['error' => 'Clave SIP invalida'];
    }

    return [
        'extension' => $extension,
        'name' => $name,
        'secret' => $secret,
        'recording' => $recording,
    ];
}

function applyNatAudioSettings(string $extension): void
{
    $db = FreePBX::Database();
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
        $stmt = $db->prepare('UPDATE sip SET data = ? WHERE id = ? AND keyword = ?');
        $stmt->execute([$value, $extension, $keyword]);
    }

    if ($extension === '1099') {
        applyWebrtcSettings($db, $extension);
    }
}

function applyLabContext(string $extension): void
{
    $db = FreePBX::Database();
    $context = extensionContext($extension);

    if ($context === null) {
        return;
    }

    $stmt = $db->prepare(
        'INSERT INTO sip (id, keyword, data, flags) VALUES (?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE data = VALUES(data)'
    );
    $stmt->execute([$extension, 'context', $context]);
}

function applyLabContextsForKnownExtensions(): void
{
    foreach (['1001', '1002', '1003', '1004', '1099', '2001', '3001', '4001', '9001', '9002', '9003', '9004', '9005'] as $extension) {
        applyLabContext($extension);
    }
}

function extensionContext(string $extension): ?string
{
    if (preg_match('/^9\d{3}$/', $extension)) {
        return 'lab-clients';
    }

    if (preg_match('/^(100[1-4]|1099|2001|3001|4001)$/', $extension)) {
        return 'lab-enterprise';
    }

    return null;
}

function applyNatAudioSettingsForAllExtensions(): void
{
    $db = FreePBX::Database();
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
        $stmt = $db->prepare('UPDATE sip SET data = ? WHERE keyword = ?');
        $stmt->execute([$value, $keyword]);
    }

    applyWebrtcSettings($db, '1099');
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
        $stmt = $db->prepare(
            'INSERT INTO sip (id, keyword, data, flags) VALUES (?, ?, ?, 0)
             ON DUPLICATE KEY UPDATE data = VALUES(data)'
        );
        $stmt->execute([$extension, $keyword, $value]);
    }
}

function applyRecordingSettings(string $extension, bool $enabled): void
{
    $mode = $enabled ? 'always' : 'dontcare';
    $astman = FreePBX::astman();

    $settings = [
        'recording/in/internal' => $mode,
        'recording/out/internal' => $mode,
        'recording/in/external' => $mode,
        'recording/out/external' => $mode,
        'recording/ondemand' => 'disabled',
        'recording/priority' => '10',
    ];

    foreach ($settings as $key => $value) {
        $astman->database_put('AMPUSER', $extension . '/' . $key, $value);
    }
}

function jsonResponse(array $body, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
}
