import net from "node:net";
import { CircuitBreaker } from "./circuitBreaker.js";
import { assertSupplierAvailable } from "./demoFailures.js";

export interface AmiCallEvent {
  type: string;
  estado: string;
  extensionOrigen: string | null;
  extensionDestino: string | null;
  uniqueId: string | null;
  linkedId: string | null;
  channel: string | null;
  destinationChannel: string | null;
  rawEvent: Record<string, string>;
}

export interface ExtensionStatus {
  extension: string;
  technology: string;
  status: string;
  reachable: boolean | null;
  lastEventAt: string;
}

export interface AmiStatus {
  enabled: boolean;
  ok: boolean;
  connected: boolean;
  host: string;
  port: number;
  lastEventAt: string | null;
  lastError: string | null;
  circuit: ReturnType<CircuitBreaker["snapshot"]>;
}

type AmiHandler = (event: AmiCallEvent) => Promise<void>;

const enabled = process.env.AMI_ENABLED === "true";
const host = process.env.AMI_HOST ?? "freepbx";
const port = Number(process.env.AMI_PORT ?? 5038);
const username = process.env.AMI_USERNAME ?? "telefonia";
const secret = process.env.AMI_SECRET ?? "telefonia_ami_dev";
const circuit = new CircuitBreaker("ami", 2, 15000);

const callEvents = new Set(["Newchannel", "DialBegin", "DialEnd", "BridgeEnter", "Hangup"]);
const extensionEvents = new Set(["ContactStatus", "DeviceStateChange", "EndpointList", "PeerStatus"]);
const extensionStatuses = new Map<string, ExtensionStatus>();

let socket: net.Socket | null = null;
let connected = false;
let lastEventAt: string | null = null;
let lastError: string | null = null;
let lastEndpointSnapshotAt = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let activeHandler: AmiHandler | null = null;

export function getAmiStatus(): AmiStatus {
  return {
    enabled,
    ok: !enabled || connected,
    connected,
    host,
    port,
    lastEventAt,
    lastError,
    circuit: circuit.snapshot()
  };
}

export async function checkAmi(): Promise<AmiStatus> {
  if (!enabled) {
    return getAmiStatus();
  }

  if (!connected && activeHandler) {
    scheduleReconnect(activeHandler);
  }

  try {
    await circuit.execute(async () => {
      assertSupplierAvailable("ami");

      if (!connected) {
        throw new Error(lastError ?? "AMI no esta conectado");
      }

      requestEndpointSnapshot();
    });

    return getAmiStatus();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return {
      ...getAmiStatus(),
      ok: false,
      lastError
    };
  }
}

export function setAmiCircuitDemo(open: boolean) {
  if (open) {
    circuit.forceOpen();
  } else {
    circuit.success();
  }
}

export function getExtensionStatuses(): ExtensionStatus[] {
  return [...extensionStatuses.values()].sort((a, b) => a.extension.localeCompare(b.extension));
}

export function startAmiListener(handler: AmiHandler) {
  if (!enabled) {
    return;
  }

  activeHandler = handler;
  connect(handler);
}

function connect(handler: AmiHandler) {
  socket?.destroy();
  socket = net.createConnection({ host, port });
  socket.setEncoding("utf8");

  let buffer = "";

  socket.on("connect", () => {
    connected = true;
    lastError = null;
    circuit.success();
    sendAmiAction({
      Action: "Login",
      Username: username,
      Secret: secret,
      Events: "on"
    });
    setTimeout(() => requestEndpointSnapshot(true), 500);
  });

  socket.on("data", (chunk) => {
    buffer += chunk;

    while (buffer.includes("\r\n\r\n")) {
      const frameEnd = buffer.indexOf("\r\n\r\n");
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 4);
      void processFrame(frame, handler).catch((error: unknown) => {
        lastError = error instanceof Error ? error.message : String(error);
        circuit.failure();
      });
    }
  });

  socket.on("error", (error) => {
    lastError = error.message;
    connected = false;
    circuit.failure();
    socket?.destroy();
    scheduleReconnect(handler);
  });

  socket.on("close", () => {
    connected = false;
    circuit.failure();
    scheduleReconnect(handler);
  });
}

function sendAmiAction(fields: Record<string, string>) {
  if (!socket) {
    return;
  }

  const payload = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\r\n");

  socket.write(`${payload}\r\n\r\n`);
}

async function processFrame(frame: string, handler: AmiHandler) {
  const parsed = parseFrame(frame);
  const eventName = parsed.Event;

  if (!eventName) {
    return;
  }

  if (extensionEvents.has(eventName)) {
    updateExtensionStatus(eventName, parsed);
  }

  if (!callEvents.has(eventName)) {
    return;
  }

  lastEventAt = new Date().toISOString();

  const callEvent: AmiCallEvent = {
    type: eventName,
    estado: mapAmiState(eventName, parsed),
    extensionOrigen:
      extractExtension(parsed.CallerIDNum) ??
      extractExtension(parsed.Channel) ??
      extractExtension(parsed.CallerIDName),
    extensionDestino:
      extractExtension(parsed.ConnectedLineNum) ??
      extractExtension(parsed.DestCallerIDNum) ??
      extractExtension(parsed.DestChannel) ??
      extractExtension(parsed.Destination) ??
      extractExtension(parsed.DialString),
    uniqueId: parsed.Uniqueid ?? parsed.DestUniqueid ?? null,
    linkedId: parsed.Linkedid ?? parsed.DestLinkedid ?? parsed.Uniqueid ?? null,
    channel: parsed.Channel ?? null,
    destinationChannel: parsed.DestChannel ?? parsed.Destination ?? null,
    rawEvent: parsed
  };

  await handler(callEvent);
}

function updateExtensionStatus(eventName: string, parsed: Record<string, string>) {
  const extension =
    extractExtension(parsed.EndpointName) ??
    extractExtension(parsed.Peer) ??
    extractExtension(parsed.Device) ??
    extractExtension(parsed.ObjectName) ??
    extractExtension(parsed.AOR);

  if (!extension) {
    return;
  }

  const status = normalizeExtensionStatus(
    parsed.ContactStatus ?? parsed.PeerStatus ?? parsed.DeviceState ?? parsed.State ?? eventName
  );
  const technology = detectTechnology(parsed);

  extensionStatuses.set(extension, {
    extension,
    technology,
    status,
    reachable: mapReachable(status),
    lastEventAt: new Date().toISOString()
  });
}

function parseFrame(frame: string): Record<string, string> {
  return frame.split("\r\n").reduce<Record<string, string>>((acc, line) => {
    const separator = line.indexOf(":");

    if (separator === -1) {
      return acc;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    acc[key] = value;
    return acc;
  }, {});
}

function extractExtension(value: string | null | undefined): string | null {
  if (!value || value === "<unknown>") {
    return null;
  }

  const direct = value.match(/^\d{2,10}$/);
  if (direct) {
    return direct[0];
  }

  const sipMatch = value.match(/(?:PJSIP|SIP)\/(\d{2,10})/i);
  if (sipMatch) {
    return sipMatch[1];
  }

  const endpointMatch = value.match(/(?:PJSIP|SIP):?(\d{2,10})/i);
  if (endpointMatch) {
    return endpointMatch[1];
  }

  const numberMatch = value.match(/\b(\d{2,10})\b/);
  return numberMatch?.[1] ?? null;
}

function mapAmiState(eventName: string, event: Record<string, string>) {
  if (eventName === "DialBegin") {
    return "RINGING";
  }

  if (eventName === "BridgeEnter") {
    return "ANSWERED";
  }

  if (eventName === "Hangup") {
    return "HANGUP";
  }

  if (eventName === "DialEnd") {
    const dialStatus = (event.DialStatus || "DIAL_END").toUpperCase();
    return dialStatus === "ANSWER" ? "ANSWERED" : dialStatus;
  }

  return eventName.toUpperCase();
}

function detectTechnology(event: Record<string, string>) {
  const value = event.Peer ?? event.Device ?? event.EndpointName ?? "";

  if (value.toUpperCase().includes("PJSIP")) {
    return "PJSIP";
  }

  if (value.toUpperCase().includes("SIP")) {
    return "SIP";
  }

  return "PJSIP";
}

function mapReachable(status: string): boolean | null {
  const normalized = normalizeExtensionStatus(status);

  if (["REACHABLE", "REGISTERED", "NOT_INUSE", "INUSE", "RINGING"].includes(normalized)) {
    return true;
  }

  if (["UNAVAILABLE", "UNREACHABLE", "UNREGISTERED", "UNKNOWN", "INVALID"].includes(normalized)) {
    return false;
  }

  return null;
}

function normalizeExtensionStatus(status: string) {
  return status.trim().toUpperCase().replace(/\s+/g, "_");
}

function requestEndpointSnapshot(force = false) {
  if (!connected) {
    return;
  }

  const now = Date.now();

  if (!force && now - lastEndpointSnapshotAt < 15000) {
    return;
  }

  lastEndpointSnapshotAt = now;
  sendAmiAction({
    Action: "PJSIPShowEndpoints",
    ActionID: `endpoints-${now}`
  });
}

function scheduleReconnect(handler: AmiHandler) {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(handler);
  }, 5000);
}
