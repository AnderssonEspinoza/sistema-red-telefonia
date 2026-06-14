import "dotenv/config";
import http from "node:http";
import cors from "cors";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { checkAmi, getExtensionStatuses, setAmiCircuitDemo, startAmiListener } from "./ami.js";
import { authConfig, login, requireAuth, verifyToken } from "./auth.js";
import { checkCdr, listRecentCdr, reconcileCallsWithCdr } from "./cdr.js";
import { CircuitBreaker } from "./circuitBreaker.js";
import {
  checkDatabase,
  createLlamada,
  createUsuario,
  ensureSchema,
  finalizarLlamada,
  getCallStats,
  listLlamadas,
  listUsuarios,
  setLlamadaEvidence,
  type Llamada,
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
  area: z.string().max(100).optional().nullable()
});

const simulateCallSchema = z.object({
  extensionOrigen: z.string().regex(/^\d{2,10}$/),
  extensionDestino: z.string().regex(/^\d{2,10}$/)
});

const demoFailureParamsSchema = z.object({
  supplier: z.enum(["postgres", "ami", "floci-sqs", "floci-s3"])
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
    response.json({ ...session, auth: authConfig() });
  } catch (error) {
    recordOperationalEvent("WARN", "auth.failed", "Intento de login fallido");

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

app.get("/api/observability", async (_request, response) => {
  const [stats, cdr] = await Promise.all([getCallStats(), checkCdr()]);

  response.json({
    metrics: metricsSnapshot(),
    callStats: stats,
    cdr,
    events: listOperationalEvents(60),
    at: new Date().toISOString()
  });
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
    const usuario = await createUsuario(input);
    broadcast("USER_CREATED", usuario);
    response.status(201).json(usuario);
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
  const [db, floci, ami, cdr] = await Promise.all([checkDatabaseWithCircuit(), checkFloci(), checkAmi(), checkCdr()]);
  const extensions = getExtensionStatuses();

  return {
    service: "telefonia-backend",
    ok: db.ok && floci.ok && ami.ok,
    db,
    floci,
    ami,
    cdr,
    auth: authConfig(),
    extensions,
    demoFailures: listDemoFailures(),
    suppliers: [
      supplierSummary("postgres", "PostgreSQL", "Base de datos", db.ok, db.error, db.circuit),
      supplierSummary("ami", "Asterisk AMI", "Eventos PBX", ami.ok, ami.lastError, ami.circuit),
      supplierSummary("floci-sqs", "Floci SQS", "Cola de eventos", floci.sqs.ok, floci.sqs.lastError, floci.sqs.circuit),
      supplierSummary("floci-s3", "Floci S3", "Evidencias JSON", floci.s3.ok, floci.s3.lastError, floci.s3.circuit)
    ],
    at: new Date().toISOString()
  };
}

async function buildDemoReport() {
  const [system, callStats, recentCalls, extensions, recentCdr] = await Promise.all([
    buildSystemStatus(),
    getCallStats(),
    listLlamadas(20),
    buildExtensionStatus(),
    listRecentCdr(20).catch(() => [])
  ]);
  const reconciliation = await reconcileCallsWithCdr(recentCalls);

  return {
    generatedAt: new Date().toISOString(),
    objective:
      "Red telefonica interna con FreePBX/Asterisk, softphones, AMI, PostgreSQL, Floci SQS/S3 y circuit breaker.",
    system,
    callStats,
    extensions,
    recentCalls,
    recentCdr,
    reconciliation,
    observability: {
      metrics: metricsSnapshot(),
      events: listOperationalEvents(100)
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
      "Hacer una llamada real 1001 -> 1002, contestar y cortar durante la presentacion.",
      "Mostrar /api/demo/report o scripts/demo-report.sh como evidencia final.",
      "Mantener FreePBX, backend, PostgreSQL, Floci y frontend activos antes de iniciar la demo."
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

  setFlociCircuitDemo(supplier, open);
}

function isDatabaseConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
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
