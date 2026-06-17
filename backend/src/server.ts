import "dotenv/config";
import http from "node:http";
import cors from "cors";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { checkAmi, getExtensionStatuses, setAmiCircuitDemo, startAmiListener } from "./ami.js";
import { authConfig, login, requireAuth, verifyToken } from "./auth.js";
import { checkCdr, listRecentCdr, listRecentCdrRecordings, reconcileCallsWithCdr } from "./cdr.js";
import { CircuitBreaker } from "./circuitBreaker.js";
import {
  checkDatabase,
  createLlamada,
  createUsuario,
  ensureSchema,
  finalizarLlamada,
  findUsuarioByExtension,
  getCallStats,
  listAuditActions,
  listLlamadas,
  listUsuarios,
  recordAuditAction,
  setLlamadaEvidence,
  type Llamada,
  updateUsuarioByExtension,
  upsertAmiLlamada
} from "./db.js";
import {
  checkFloci,
  flociStatus,
  initFloci,
  publishCallEvent,
  setFlociCircuitDemo
} from "./floci.js";
import {
  assertSupplierAvailable,
  isDemoFailureEnabled,
  listDemoFailures,
  setDemoFailure,
  type DemoSupplier
} from "./demoFailures.js";
import {
  listOperationalEvents,
  metricsSnapshot,
  recordCallMetric,
  recordOperationalEvent,
  requestMetrics
} from "./observability.js";
import { sliConfig } from "./sli.js";
import {
  analyzeCallText,
  callCenterConfig,
  callCenterOverview,
  checkCallCenter,
  dialNextLead,
  listDialerLeads,
  listTranscripts,
  setCallCenterCircuitDemo
} from "./callCenter.js";
import {
  checkFreepbxProvisioner,
  configureFreepbxNetwork,
  freepbxProvisionerConfig,
  provisionFreepbxExtension
} from "./freepbxProvisioner.js";
import { enrichRecordings, recordingConfig, resolveRecordingFile } from "./recordings.js";

const port = Number(process.env.PORT ?? 3000);
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const dbCircuit = new CircuitBreaker("postgres", 2, 15000);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({ origin: frontendOrigin }));
app.use(express.json());
app.use(requestMetrics);

const usuarioSchema = z.object({
  nombre: z.string().min(2).max(100),
  extension: z.string().regex(/^\d{2,10}$/),
  procedencia: z.string().max(100).optional().nullable(),
  area: z.string().max(100).optional().nullable(),
  provisionFreepbx: z.boolean().default(true),
  sipSecret: z
    .string()
    .min(8)
    .max(80)
    .regex(/^[A-Za-z0-9_.@#-]+$/)
    .optional()
    .nullable(),
  recordCalls: z.boolean().default(true)
});

const usuarioUpdateSchema = z.object({
  nombre: z.string().min(2).max(100),
  procedencia: z.string().max(100).optional().nullable(),
  area: z.string().max(100).optional().nullable()
});

const telephonyNetworkSchema = z.object({
  lanIp: z
    .string()
    .regex(/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/),
  lanCidr: z.number().int().min(8).max(30).default(16)
});

const simulateCallSchema = z.object({
  extensionOrigen: z.string().regex(/^\d{2,10}$/),
  extensionDestino: z.string().regex(/^\d{2,10}$/)
});

const dialNextSchema = z.object({
  agentExtension: z.string().regex(/^\d{2,10}$/).optional()
});

const analyzeTextSchema = z.object({
  callId: z.string().min(1).max(120),
  leadName: z.string().max(120).optional().nullable(),
  agentExtension: z.string().regex(/^\d{2,10}$/).optional().nullable(),
  recordingFile: z.string().max(240).optional().nullable(),
  text: z.string().max(5000).optional().nullable()
});

const demoFailureParamsSchema = z.object({
  supplier: z.enum(["postgres", "ami", "floci-sqs", "floci-s3", "dialer", "transcription", "metrics"])
});

const demoFailureBodySchema = z.object({
  enabled: z.boolean()
});

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200)
});

wss.on("connection", (client, request) => {
  const token = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).searchParams.get("token");

  if (!verifyToken(token)) {
    client.close(1008, "No autorizado");
    return;
  }

  client.send(JSON.stringify({ type: "CONNECTED", at: new Date().toISOString() }));
});

app.get("/api/auth/config", (_request, response) => {
  response.json(authConfig());
});

app.post("/api/auth/login", (request, response, next) => {
  try {
    const input = loginSchema.parse(request.body);
    const session = login(input);
    recordOperationalEvent("INFO", "auth.login", "Inicio de sesion exitoso", { username: session.username });
    void writeAudit(request, {
      actor: session.username,
      accion: "auth.login",
      entidad: "session",
      detalle: { username: session.username }
    });
    response.json({ ...session, auth: authConfig() });
  } catch (error) {
    recordOperationalEvent("WARN", "auth.failed", "Intento de login fallido");
    void writeAudit(request, {
      actor: "anonimo",
      accion: "auth.failed",
      entidad: "session",
      detalle: { username: request.body?.username ?? null }
    });

    if (error instanceof z.ZodError) {
      next(error);
      return;
    }

    response.status(401).json({ error: "Credenciales invalidas" });
  }
});

app.get("/api/health", async (_request, response) => {
  response.json(await buildSystemStatus());
});

app.use("/api", requireAuth);

app.get("/api/auth/me", (_request, response) => {
  response.json({ user: response.locals.user, auth: authConfig() });
});

app.get("/api/system", async (_request, response) => {
  response.json(await buildSystemStatus());
});

app.get("/api/telephony/network/detect", async (request, response, next) => {
  try {
    const host = String(request.headers["x-forwarded-host"] ?? request.headers.host ?? "").split(",")[0].trim();
    const requestHost = host.split(":")[0];
    const provisioner = await checkFreepbxProvisioner();
    const configuredIp = "network" in provisioner ? provisioner.network?.externip ?? null : null;
    const detectedIp = isUsableLanIp(requestHost) ? requestHost : configuredIp;

    if (!detectedIp) {
      response.status(404).json({ error: "No se pudo detectar una IP LAN utilizable" });
      return;
    }

    const lanCidr = suggestCidr(detectedIp);

    response.json({
      lanIp: detectedIp,
      lanCidr,
      lanNet: networkAddress(detectedIp, lanCidr),
      source: isUsableLanIp(requestHost) ? "request-host" : "freepbx-config",
      current: configuredIp,
      requestHost: requestHost || null
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/observability", async (_request, response) => {
  const [stats, cdr, audit, recordings, callCenter] = await Promise.all([
    getCallStats(),
    checkCdr(),
    listAuditActions(20),
    listRecentCdrRecordings(20)
      .then((records) => enrichRecordings(records))
      .catch(() => []),
    checkCallCenter().catch(() => null)
  ]);

  response.json({
    metrics: metricsSnapshot(),
    sli: sliConfig(),
    callStats: stats,
    cdr,
    callCenter,
    recording: recordingConfig(),
    recordings,
    audit,
    events: listOperationalEvents(60),
    at: new Date().toISOString()
  });
});

app.get("/api/sli/ping", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({
    ok: true,
    service: "telefonia-backend",
    receivedAt: new Date().toISOString(),
    sli: sliConfig().localLatency
  });
});

app.get("/api/audit", async (request, response, next) => {
  try {
    const limit = Number(request.query.limit ?? 50);
    response.json(await listAuditActions(Number.isFinite(limit) ? limit : 50));
  } catch (error) {
    next(error);
  }
});

app.get("/api/recordings", async (request, response, next) => {
  try {
    const limit = Number(request.query.limit ?? 20);
    const records = await listRecentCdrRecordings(Number.isFinite(limit) ? limit : 20);
    response.json({
      config: recordingConfig(),
      recordings: await enrichRecordings(records),
      at: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/recordings/:filename", async (request, response, next) => {
  try {
    const recording = await resolveRecordingFile(request.params.filename, String(request.query.date ?? ""));

    if (!recording) {
      response.status(404).json({ error: "Grabacion no encontrada" });
      return;
    }

    response.download(recording.path, recording.filename);
  } catch (error) {
    next(error);
  }
});

app.get("/api/cdr/reconcile", async (request, response, next) => {
  try {
    const limit = Number(request.query.limit ?? 20);
    const calls = await listLlamadas(Number.isFinite(limit) ? limit : 20);
    const [cdr, reconciliation] = await Promise.all([listRecentCdr(20), reconcileCallsWithCdr(calls)]);

    response.json({
      cdr,
      reconciliation,
      at: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/demo/report", async (_request, response, next) => {
  try {
    response.json(await buildDemoReport());
  } catch (error) {
    next(error);
  }
});

app.get("/api/extensions/status", async (_request, response, next) => {
  try {
    response.json(await buildExtensionStatus());
  } catch (error) {
    next(error);
  }
});

app.get("/api/call-center/overview", async (_request, response, next) => {
  try {
    response.json(await callCenterOverview());
  } catch (error) {
    next(error);
  }
});

app.get("/api/call-center/leads", async (_request, response, next) => {
  try {
    response.json(await listDialerLeads());
  } catch (error) {
    next(error);
  }
});

app.post("/api/call-center/dial-next", async (request, response, next) => {
  try {
    const input = dialNextSchema.parse(request.body);
    const result = await dialNextLead(input.agentExtension);
    void writeAudit(request, {
      accion: "callcenter.dial.next",
      entidad: "campaign",
      entidadId: "default",
      detalle: { agentExtension: input.agentExtension ?? null, result }
    });
    response.status(result?.ok === false ? 202 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/call-center/transcripts", async (_request, response, next) => {
  try {
    response.json(await listTranscripts());
  } catch (error) {
    next(error);
  }
});

app.post("/api/call-center/analyze", async (request, response, next) => {
  try {
    const input = analyzeTextSchema.parse(request.body);
    const result = await analyzeCallText(input);
    void writeAudit(request, {
      accion: "callcenter.transcription.analyzed",
      entidad: "transcript",
      entidadId: input.callId,
      detalle: {
        leadName: input.leadName ?? null,
        sensitiveMasked: result?.transcript?.sensitiveDataMasked ?? null,
        opportunity: result?.transcript?.analysis?.opportunity ?? null
      }
    });
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/call-center/security", (_request, response) => {
  response.json({
    security: callCenterConfig().security,
    segmentation: {
      implemented: "Docker network boundary for lab",
      productionDesign: "Voice VLAN for SIP/RTP phones, app VLAN for backend/microservices, data VLAN for databases"
    },
    pii: {
      masking: "Credit card PAN masking before storing visible transcript",
      encryptedOriginal: "Original transcript encrypted in MongoDB"
    }
  });
});

app.post("/api/demo/failures/:supplier", async (request, response, next) => {
  try {
    const { supplier } = demoFailureParamsSchema.parse(request.params);
    const { enabled } = demoFailureBodySchema.parse(request.body);

    setDemoFailure(supplier, enabled);
    setSupplierCircuitState(supplier, enabled);
    recordOperationalEvent(enabled ? "WARN" : "INFO", "demo.failure", "Cambio de falla controlada", {
      supplier,
      enabled
    });
    void writeAudit(request, {
      accion: enabled ? "supplier.failure.enabled" : "supplier.failure.disabled",
      entidad: "supplier",
      entidadId: supplier,
      detalle: { supplier, enabled }
    });
    response.json(await buildSystemStatus());
  } catch (error) {
    next(error);
  }
});

app.get("/api/users", async (_request, response, next) => {
  try {
    response.json(await listUsuarios());
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", async (request, response, next) => {
  try {
    const input = usuarioSchema.parse(request.body);
    const existing = await findUsuarioByExtension(input.extension);

    if (existing) {
      response.status(409).json({ error: "La extension ya existe" });
      return;
    }

    const sipSecret = input.sipSecret?.trim() || `Telefonia${input.extension}`;
    const provisioning = input.provisionFreepbx
      ? await provisionFreepbxExtension({
          extension: input.extension,
          name: input.nombre,
          secret: sipSecret,
          recording: input.recordCalls
        })
      : null;
    const usuario = await createUsuario({
      nombre: input.nombre,
      extension: input.extension,
      procedencia: input.procedencia,
      area: input.area
    });

    void writeAudit(request, {
      accion: "user.created",
      entidad: "usuario",
      entidadId: usuario.id,
      detalle: {
        extension: usuario.extension,
        nombre: usuario.nombre,
        area: usuario.area,
        provisionFreepbx: input.provisionFreepbx,
        recording: input.recordCalls,
        provisioning
      }
    });
    broadcast("USER_CREATED", usuario);
    response.status(201).json({ ...usuario, provisioning, sipSecret: input.provisionFreepbx ? sipSecret : null });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/users/:extension", async (request, response, next) => {
  try {
    const extension = z.string().regex(/^\d{2,10}$/).parse(request.params.extension);
    const input = usuarioUpdateSchema.parse(request.body);
    const usuario = await updateUsuarioByExtension(extension, {
      nombre: input.nombre,
      procedencia: input.procedencia,
      area: input.area
    });

    if (!usuario) {
      response.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    void writeAudit(request, {
      accion: "user.updated",
      entidad: "usuario",
      entidadId: usuario.id,
      detalle: {
        extension: usuario.extension,
        nombre: usuario.nombre,
        area: usuario.area,
        procedencia: usuario.procedencia
      }
    });
    broadcast("USER_UPDATED", usuario);
    response.json(usuario);
  } catch (error) {
    next(error);
  }
});

app.post("/api/telephony/network", async (request, response, next) => {
  try {
    const input = telephonyNetworkSchema.parse(request.body);
    const result = await configureFreepbxNetwork(input);

    void writeAudit(request, {
      accion: "telephony.network.updated",
      entidad: "freepbx",
      entidadId: "sip-rtp-network",
      detalle: { ...result }
    });
    recordOperationalEvent("INFO", "telephony.network.updated", "Red SIP/RTP actualizada", {
      lanIp: result.lanIp,
      lanNet: result.lanNet,
      lanCidr: result.lanCidr
    });

    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/calls", async (request, response, next) => {
  try {
    const limit = Number(request.query.limit ?? 50);
    response.json(await listLlamadas(Number.isFinite(limit) ? limit : 50));
  } catch (error) {
    next(error);
  }
});

app.post("/api/calls/:id/end", async (request, response, next) => {
  try {
    let llamada = await finalizarLlamada(Number(request.params.id));

    if (!llamada) {
      response.status(404).json({ error: "Llamada no encontrada" });
      return;
    }

    llamada = await publishCallSnapshot(llamada);
    recordCallMetric({
      id: llamada.id,
      estado: llamada.estado,
      fuente: llamada.fuente,
      evidenciaKey: llamada.evidencia_key
    });
    void writeAudit(request, {
      accion: "call.closed.manual",
      entidad: "llamada",
      entidadId: llamada.id,
      detalle: {
        estado: llamada.estado,
        extensionOrigen: llamada.extension_origen,
        extensionDestino: llamada.extension_destino
      }
    });
    broadcast("CALL_UPDATED", llamada);
    response.json(llamada);
  } catch (error) {
    next(error);
  }
});

app.post("/api/simulate-call", async (request, response, next) => {
  try {
    const input = simulateCallSchema.parse(request.body);
    const simulatedId = `sim-${Date.now()}`;
    const llamada = await registerCallEvent({
      extensionOrigen: input.extensionOrigen,
      extensionDestino: input.extensionDestino,
      estado: "RINGING",
      fuente: "simulador",
      eventType: "SIMULATED_CALL",
      rawEvent: { type: "SIMULATED_CALL", correlationId: simulatedId }
    });

    void writeAudit(request, {
      accion: "call.simulated",
      entidad: "llamada",
      entidadId: llamada.id,
      detalle: {
        extensionOrigen: input.extensionOrigen,
        extensionDestino: input.extensionDestino,
        evidenciaKey: llamada.evidencia_key
      }
    });
    response.status(201).json(llamada);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: "Datos invalidos", details: error.issues });
    return;
  }

  if (isDatabaseConflict(error)) {
    response.status(409).json({ error: "La extension ya existe" });
    return;
  }

  const message = error instanceof Error ? error.message : "Error interno";
  recordOperationalEvent("ERROR", "api.error", message);
  response.status(500).json({ error: message });
});

async function registerCallEvent(input: {
  extensionOrigen: string | null;
  extensionDestino: string | null;
  estado: string;
  fuente: string;
  eventType: string;
  rawEvent: Record<string, unknown>;
  amiUniqueId?: string | null;
  amiLinkedId?: string | null;
}) {
  let llamada =
    input.fuente === "ami"
      ? await upsertAmiLlamada({
          extensionOrigen: input.extensionOrigen,
          extensionDestino: input.extensionDestino,
          estado: input.estado,
          fuente: input.fuente,
          eventType: input.eventType,
          amiUniqueId: input.amiUniqueId ?? null,
          amiLinkedId: input.amiLinkedId ?? input.amiUniqueId ?? null,
          rawEvent: input.rawEvent
        })
      : await createLlamada({
          extensionOrigen: input.extensionOrigen,
          extensionDestino: input.extensionDestino,
          estado: input.estado,
          fuente: input.fuente,
          rawEvent: input.rawEvent
        });

  llamada = await publishCallSnapshot(llamada);

  recordCallMetric({
    id: llamada.id,
    estado: llamada.estado,
    fuente: llamada.fuente,
    amiLinkedId: llamada.ami_linkedid,
    evidenciaKey: llamada.evidencia_key
  });
  broadcast(input.fuente === "ami" ? "CALL_UPDATED" : "CALL_EVENT", llamada);
  return llamada;
}

async function publishCallSnapshot(llamada: Llamada) {
  const publishResult = await publishCallEvent({
    id: llamada.id,
    extensionOrigen: llamada.extension_origen,
    extensionDestino: llamada.extension_destino,
    estado: llamada.estado,
    fuente: llamada.fuente,
    amiUniqueId: llamada.ami_uniqueid,
    amiLinkedId: llamada.ami_linkedid,
    ultimoEvento: llamada.ultimo_evento,
    fechaInicio: llamada.fecha_inicio,
    fechaFin: llamada.fecha_fin,
    duracionSegundos: llamada.duracion_segundos
  });

  if (publishResult.evidenceKey) {
    return (await setLlamadaEvidence(llamada.id, publishResult.evidenceKey)) ?? llamada;
  }

  return llamada;
}

function broadcast(type: string, payload: unknown) {
  const message = JSON.stringify({ type, payload, at: new Date().toISOString() });

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

async function buildSystemStatus() {
  const [db, floci, ami, cdr, provisioner, callCenter] = await Promise.all([
    checkDatabaseWithCircuit(),
    checkFloci(),
    checkAmi(),
    checkCdr(),
    checkFreepbxProvisioner(),
    checkCallCenter()
  ]);
  const extensions = getExtensionStatuses();

  return {
    service: "telefonia-backend",
    ok: db.ok && floci.ok && ami.ok && provisioner.ok && callCenter.ok,
    db,
    floci,
    ami,
    cdr,
    callCenter,
    sli: sliConfig(),
    provisioner,
    recording: recordingConfig(),
    auth: authConfig(),
    extensions,
    demoFailures: listDemoFailures(),
    suppliers: [
      supplierSummary("postgres", "PostgreSQL", "Base de datos", db.ok, db.error, db.circuit),
      supplierSummary("ami", "Asterisk AMI", "Eventos PBX", ami.ok, ami.lastError, ami.circuit),
      supplierSummary("floci-sqs", "Floci SQS", "Cola de eventos", floci.sqs.ok, floci.sqs.lastError, floci.sqs.circuit),
      supplierSummary("floci-s3", "Floci S3", "Evidencias JSON", floci.s3.ok, floci.s3.lastError, floci.s3.circuit),
      ...callCenter.services.map((service) =>
        supplierSummary(service.supplier, service.label, service.role, service.ok, service.error, service.circuit)
      )
    ],
    at: new Date().toISOString()
  };
}

async function buildDemoReport() {
  const [system, callStats, recentCalls, extensions, recentCdr, recordings, audit, callCenter] = await Promise.all([
    buildSystemStatus(),
    getCallStats(),
    listLlamadas(20),
    buildExtensionStatus(),
    listRecentCdr(20).catch(() => []),
    listRecentCdrRecordings(30)
      .then((records) => enrichRecordings(records))
      .catch(() => []),
    listAuditActions(100),
    callCenterOverview().catch(() => null)
  ]);
  const reconciliation = await reconcileCallsWithCdr(recentCalls);

  return {
    generatedAt: new Date().toISOString(),
    objective:
      "Operaciones de ventas call center con FreePBX/Asterisk, marcador Python, transcripcion, analisis de calidad, Redis, MongoDB, Floci SQS/S3 y circuit breaker.",
    system,
    callStats,
    extensions,
    recentCalls,
    recentCdr,
    recordings,
    callCenter,
    reconciliation,
    observability: {
      metrics: metricsSnapshot(),
      events: listOperationalEvents(100)
    },
    audit,
    freepbxProvisioning: {
      provisioner: freepbxProvisionerConfig(),
      recording: recordingConfig()
    },
    reliability: {
      sli: system.sli,
      note:
        "El backend conserva una medicion SLI/SLO de latencia local para confiabilidad interna. El dashboard principal se centra en operacion de llamadas, proveedores y calidad."
    },
    evidence: {
      bucket: system.floci.bucketName,
      callsWithEvidence: callStats.withEvidence,
      coveragePercent: callStats.evidenceCoveragePercent,
      recentCallsWithEvidence: callStats.recentWithEvidence,
      recentCoveragePercent: callStats.recentEvidenceCoveragePercent
    },
    security: {
      authEnabled: system.auth.enabled,
      defaultCredentials: system.auth.defaultCredentials,
      note: system.auth.defaultCredentials
        ? "Cambiar AUTH_USERNAME, AUTH_PASSWORD y AUTH_TOKEN_SECRET antes de presentar como produccion."
        : "Credenciales personalizadas configuradas."
    },
    recommendations: [
      "Registrar softphones 1001 y 1002 antes de probar marcacion real.",
      "Usar Marcar lead para demostrar AMI Originate y Analizar texto demo para MongoDB/enmascaramiento.",
      "Mostrar /api/demo/report o scripts/demo-report.sh como evidencia final.",
      "Mantener FreePBX, backend, PostgreSQL, Redis, MongoDB, Floci, microservicios y frontend activos antes de iniciar la demo."
    ]
  };
}

async function checkDatabaseWithCircuit() {
  try {
    await dbCircuit.execute(async () => {
      assertSupplierAvailable("postgres");
      await checkDatabase();
    });

    return { ok: true, error: null, circuit: dbCircuit.snapshot() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      circuit: dbCircuit.snapshot()
    };
  }
}

function isUsableLanIp(value: string | null | undefined) {
  if (!value || !/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value)) {
    return false;
  }

  return !["127.", "0.", "169.254."].some((prefix) => value.startsWith(prefix)) && value !== "localhost";
}

function suggestCidr(ip: string) {
  if (ip.startsWith("10.")) {
    return 16;
  }

  return 24;
}

function networkAddress(ip: string, cidr: number) {
  const parts = ip.split(".").map((part) => Number(part));
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  const address = parts.reduce((acc, part) => ((acc << 8) + part) >>> 0, 0);
  const network = (address & mask) >>> 0;

  return [24, 16, 8, 0].map((shift) => (network >>> shift) & 255).join(".");
}

async function buildExtensionStatus() {
  const [usuarios, amiExtensions] = await Promise.all([listUsuarios(), Promise.resolve(getExtensionStatuses())]);
  const statusByExtension = new Map(amiExtensions.map((extension) => [extension.extension, extension]));

  return usuarios.map((usuario) => {
    const amiStatus = statusByExtension.get(usuario.extension);

    return {
      extension: usuario.extension,
      nombre: usuario.nombre,
      area: usuario.area,
      usuarioEstado: usuario.estado,
      technology: amiStatus?.technology ?? "PJSIP",
      status: amiStatus?.status ?? "UNKNOWN",
      reachable: amiStatus?.reachable ?? null,
      lastEventAt: amiStatus?.lastEventAt ?? null
    };
  });
}

function supplierSummary(
  supplier: DemoSupplier,
  label: string,
  role: string,
  ok: boolean,
  error: string | null,
  circuit: ReturnType<CircuitBreaker["snapshot"]>
) {
  return {
    supplier,
    label,
    role,
    ok,
    error,
    circuit,
    demoFailure: isDemoFailureEnabled(supplier)
  };
}

function setSupplierCircuitState(supplier: DemoSupplier, open: boolean) {
  if (supplier === "postgres") {
    if (open) {
      dbCircuit.forceOpen();
    } else {
      dbCircuit.success();
    }
    return;
  }

  if (supplier === "ami") {
    setAmiCircuitDemo(open);
    return;
  }

  if (["dialer", "transcription", "metrics"].includes(supplier)) {
    setCallCenterCircuitDemo(supplier, open);
    return;
  }

  setFlociCircuitDemo(supplier, open);
}

function isDatabaseConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function writeAudit(
  request: express.Request,
  input: {
    actor?: string;
    accion: string;
    entidad?: string | null;
    entidadId?: string | number | null;
    detalle?: Record<string, unknown> | null;
  }
) {
  const user = responseUser(request);

  try {
    await recordAuditAction({
      actor: input.actor ?? user ?? "sistema",
      accion: input.accion,
      entidad: input.entidad,
      entidadId: input.entidadId,
      detalle: {
        ...(input.detalle ?? {}),
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null
      }
    });
  } catch (error) {
    recordOperationalEvent("WARN", "audit.failed", error instanceof Error ? error.message : String(error));
  }
}

function responseUser(request: express.Request) {
  const response = request.res as express.Response | undefined;
  const user = response?.locals.user as { username?: string } | undefined;
  return user?.username ?? null;
}

await ensureSchema();
await initFloci().catch((error: unknown) => {
  console.warn("Floci init failed", error);
});

startAmiListener(async (event) => {
  await registerCallEvent({
    extensionOrigen: event.extensionOrigen,
    extensionDestino: event.extensionDestino,
    estado: event.estado,
    fuente: "ami",
    eventType: event.type,
    amiUniqueId: event.uniqueId,
    amiLinkedId: event.linkedId,
    rawEvent: event.rawEvent
  });
});

server.listen(port, () => {
  console.log(`telefonia-backend listening on ${port}`);
  console.log("floci", flociStatus());
});
