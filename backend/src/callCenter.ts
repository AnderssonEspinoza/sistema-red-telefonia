import { CircuitBreaker } from "./circuitBreaker.js";
import { assertSupplierAvailable, type DemoSupplier } from "./demoFailures.js";

const dialerUrl = process.env.DIALER_SERVICE_URL ?? "http://dialer-service:7010";
const transcriptionUrl = process.env.TRANSCRIPTION_SERVICE_URL ?? "http://transcription-service:7020";
const metricsUrl = process.env.METRICS_SERVICE_URL ?? "http://metrics-service:7030";
const defaultAgentExtension = process.env.DEFAULT_AGENT_EXTENSION ?? "1001";
const callMode = process.env.CALL_MODE ?? "lab_internal";

const dialerCircuit = new CircuitBreaker("dialer", 3, 15000);
const transcriptionCircuit = new CircuitBreaker("transcription", 3, 15000);
const metricsCircuit = new CircuitBreaker("metrics", 3, 15000);

export interface CallCenterServiceStatus {
  supplier: DemoSupplier;
  label: string;
  role: string;
  ok: boolean;
  error: string | null;
  circuit: ReturnType<CircuitBreaker["snapshot"]>;
}

export function callCenterConfig() {
  return {
    dialerUrl,
    transcriptionUrl,
    metricsUrl,
    defaultAgentExtension,
    callMode,
    labModeNote:
      callMode === "lab_internal"
        ? "Modo laboratorio: clientes simulados por softphone 9001-9005, sin PSTN ni SIP trunk real."
        : "Modo reservado para preparacion futura; no conecta un proveedor SIP real.",
    stateStore: "Redis",
    transcriptStore: "MongoDB",
    asteriskControl: "Python AGI + AMI Originate",
    security: {
      sensitiveMasking: "credit-card-pan",
      transcriptEncryption: "Fernet/AES envelope",
      recordingEncryptionMode: process.env.RECORDING_ENCRYPTION_MODE ?? "aes-256-gcm-archive",
      voiceSegmentation: "Docker voice boundary, SIP/RTP ports isolated for lab; VLAN design documented for real network"
    }
  };
}

export async function checkCallCenter() {
  const [dialer, transcription, metrics] = await Promise.all([
    checkService("dialer", dialerUrl, dialerCircuit),
    checkService("transcription", transcriptionUrl, transcriptionCircuit),
    checkService("metrics", metricsUrl, metricsCircuit)
  ]);

  return {
    ok: dialer.ok && transcription.ok && metrics.ok,
    config: callCenterConfig(),
    services: [
      serviceSummary("dialer", "Marcador Python", "Marcacion inteligente", dialer, dialerCircuit),
      serviceSummary("transcription", "Transcripcion IA", "Voz a texto y calidad", transcription, transcriptionCircuit),
      serviceSummary("metrics", "Metricas Call Center", "Indicadores comerciales", metrics, metricsCircuit)
    ]
  };
}

export async function callCenterOverview() {
  const [health, metrics, leads, transcripts] = await Promise.all([
    checkCallCenter(),
    fetchJson(`${metricsUrl}/summary`, "metrics", metricsCircuit).catch(() => null),
    fetchJson(`${dialerUrl}/leads`, "dialer", dialerCircuit).catch(() => ({ leads: [], pending: 0 })),
    fetchJson(`${transcriptionUrl}/transcriptions?limit=8`, "transcription", transcriptionCircuit).catch(() => ({
      transcripts: []
    }))
  ]);

  return {
    health,
    metrics,
    leads,
    transcripts,
    at: new Date().toISOString()
  };
}

export async function listDialerLeads() {
  return fetchJson(`${dialerUrl}/leads`, "dialer", dialerCircuit);
}

export async function dialNextLead(agentExtension = defaultAgentExtension) {
  return fetchJson(`${dialerUrl}/dial/next`, "dialer", dialerCircuit, {
    method: "POST",
    body: JSON.stringify({ agentExtension })
  });
}

export async function listTranscripts() {
  return fetchJson(`${transcriptionUrl}/transcriptions?limit=20`, "transcription", transcriptionCircuit);
}

export async function analyzeCallText(input: {
  callId: string;
  leadName?: string | null;
  agentExtension?: string | null;
  recordingFile?: string | null;
  text?: string | null;
}) {
  return fetchJson(`${transcriptionUrl}/transcriptions`, "transcription", transcriptionCircuit, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function setCallCenterCircuitDemo(supplier: DemoSupplier, open: boolean) {
  const circuit =
    supplier === "dialer" ? dialerCircuit : supplier === "transcription" ? transcriptionCircuit : supplier === "metrics" ? metricsCircuit : null;

  if (!circuit) {
    return;
  }

  if (open) {
    circuit.forceOpen();
  } else {
    circuit.success();
  }
}

async function checkService(supplier: DemoSupplier, baseUrl: string, circuit: CircuitBreaker) {
  try {
    await fetchJson(`${baseUrl}/health`, supplier, circuit);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchJson(url: string, supplier: DemoSupplier, circuit: CircuitBreaker, init: RequestInit = {}) {
  return circuit.execute(async () => {
    assertSupplierAvailable(supplier);
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`${supplier} HTTP ${response.status}${body ? `: ${body}` : ""}`);
    }

    return response.json();
  });
}

function serviceSummary(
  supplier: DemoSupplier,
  label: string,
  role: string,
  status: { ok: boolean; error: string | null },
  circuit: CircuitBreaker
): CallCenterServiceStatus {
  return {
    supplier,
    label,
    role,
    ok: status.ok,
    error: status.error,
    circuit: circuit.snapshot()
  };
}
