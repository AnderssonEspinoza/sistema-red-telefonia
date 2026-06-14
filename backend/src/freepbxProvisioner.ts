const enabled = process.env.FREEPBX_PROVISIONER_ENABLED !== "false";
const provisionerUrl = process.env.FREEPBX_PROVISIONER_URL ?? "http://freepbx/provisioner.php";
const provisionerToken = process.env.FREEPBX_PROVISIONER_TOKEN ?? "telefonia_provisioner_dev";

export interface FreepbxProvisionInput {
  extension: string;
  name: string;
  secret: string;
  recording: boolean;
}

export interface FreepbxProvisionResult {
  enabled: boolean;
  ok: boolean;
  created: boolean;
  exists: boolean;
  repaired: boolean;
  extension: string;
  reload: boolean;
  message: string;
}

export function freepbxProvisionerConfig() {
  return {
    enabled,
    url: provisionerUrl,
    configured: Boolean(provisionerUrl && provisionerToken)
  };
}

export async function checkFreepbxProvisioner() {
  if (!enabled) {
    return { ...freepbxProvisionerConfig(), ok: true, error: null };
  }

  try {
    const response = await fetch(provisionerUrl, {
      headers: authorizationHeaders()
    });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; version?: string } | null;

    return {
      ...freepbxProvisionerConfig(),
      ok: response.ok && body?.ok === true,
      error: response.ok ? null : `FreePBX provisioner HTTP ${response.status}`,
      version: body?.version ?? null
    };
  } catch (error) {
    return {
      ...freepbxProvisionerConfig(),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      version: null
    };
  }
}

export async function provisionFreepbxExtension(input: FreepbxProvisionInput): Promise<FreepbxProvisionResult> {
  if (!enabled) {
    return {
      enabled,
      ok: true,
      created: false,
      exists: false,
      repaired: false,
      extension: input.extension,
      reload: false,
      message: "Provisionamiento FreePBX deshabilitado"
    };
  }

  const response = await fetch(provisionerUrl, {
    method: "POST",
    headers: {
      ...authorizationHeaders(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => null)) as Partial<FreepbxProvisionResult> & { error?: string } | null;

  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.error ?? `FreePBX provisioner HTTP ${response.status}`);
  }

  return {
    enabled,
    ok: true,
    created: Boolean(body.created),
    exists: Boolean(body.exists),
    repaired: Boolean(body.repaired),
    extension: String(body.extension ?? input.extension),
    reload: Boolean(body.reload),
    message: String(body.message ?? "Extension provisionada")
  };
}

function authorizationHeaders() {
  return {
    Authorization: `Bearer ${provisionerToken}`,
    "X-Provisioner-Token": provisionerToken
  };
}
