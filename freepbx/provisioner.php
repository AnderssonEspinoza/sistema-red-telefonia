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
        jsonResponse(['ok' => true, 'service' => 'freepbx-provisioner', 'version' => '1.1']);
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

    $validated = validatePayload($payload);

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
                'max_contacts' => 2,
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
