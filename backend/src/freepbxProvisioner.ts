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

export interface FreepbxNetworkInput {
  lanIp: string;
  lanCidr: number;
}

export interface FreepbxNetworkResult {
  enabled: boolean;
  ok: boolean;
  lanIp: string;
  lanNet: string;
  lanCidr: number;
  rtpStart: number;
  rtpEnd: number;
  reload: boolean;
  message: string;
}

export interface FreepbxProvisionerNetworkStatus {
  externip?: string | null;
  localnets?: unknown;
  rtpstart?: string | number | null;
  rtpend?: string | number | null;
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
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      version?: string;
      network?: FreepbxProvisionerNetworkStatus | null;
    } | null;

    return {
      ...freepbxProvisionerConfig(),
      ok: response.ok && body?.ok === true,
      error: response.ok ? null : `FreePBX provisioner HTTP ${response.status}`,
      version: body?.version ?? null,
      network: body?.network ?? null
    };
  } catch (error) {
    return {
      ...freepbxProvisionerConfig(),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      version: null,
      network: null
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

export async function configureFreepbxNetwork(input: FreepbxNetworkInput): Promise<FreepbxNetworkResult> {
  const lanNet = networkAddress(input.lanIp, input.lanCidr);

  if (!enabled) {
    return {
      enabled,
      ok: true,
      lanIp: input.lanIp,
      lanNet,
      lanCidr: input.lanCidr,
      rtpStart: 10000,
      rtpEnd: 10100,
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
    body: JSON.stringify({
      action: "configure-network",
      lanIp: input.lanIp,
      lanNet,
      lanCidr: input.lanCidr
    })
  });
  const body = (await response.json().catch(() => null)) as Partial<FreepbxNetworkResult> & { error?: string } | null;

  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.error ?? `FreePBX provisioner HTTP ${response.status}`);
  }

  return {
    enabled,
    ok: true,
    lanIp: String(body.lanIp ?? input.lanIp),
    lanNet: String(body.lanNet ?? lanNet),
    lanCidr: Number(body.lanCidr ?? input.lanCidr),
    rtpStart: Number(body.rtpStart ?? 10000),
    rtpEnd: Number(body.rtpEnd ?? 10100),
    reload: Boolean(body.reload),
    message: String(body.message ?? "Red SIP/RTP actualizada")
  };
}

function networkAddress(ip: string, cidr: number) {
  const parts = ip.split(".").map((part) => Number(part));
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  const address = parts.reduce((acc, part) => ((acc << 8) + part) >>> 0, 0);
  const network = (address & mask) >>> 0;

  return [24, 16, 8, 0].map((shift) => (network >>> shift) & 255).join(".");
}

function authorizationHeaders() {
  return {
    Authorization: `Bearer ${provisionerToken}`,
    "X-Provisioner-Token": provisionerToken
  };
}
