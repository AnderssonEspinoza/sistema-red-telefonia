import { FormEvent, type ReactNode, type RefObject, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Invitation, Inviter, Registerer, SessionState, UserAgent } from "sip.js";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Cloud,
  Database,
  Download,
  FileAudio,
  FileText,
  Headphones,
  Home,
  LogIn,
  LogOut,
  Phone,
  PhoneCall,
  Pencil,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Square,
  UserRound,
  Users,
  Video,
  Wifi,
  WifiOff,
  X
} from "lucide-react";

const browserHost = window.location.hostname || "localhost";
const API_URL = import.meta.env.VITE_API_URL ?? `http://${browserHost}:3000`;
const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${browserHost}:3000`;

type DemoSupplier = "postgres" | "ami" | "floci-sqs" | "floci-s3" | "dialer" | "transcription" | "metrics";

interface Usuario {
  id: number;
  nombre: string;
  extension: string;
  procedencia: string | null;
  area: string | null;
  estado: string;
}

interface Llamada {
  id: number;
  extension_origen: string | null;
  extension_destino: string | null;
  nombre_origen: string | null;
  nombre_destino: string | null;
  estado: string;
  fuente: string;
  ami_uniqueid: string | null;
  ami_linkedid: string | null;
  ultimo_evento: string | null;
  fecha_inicio: string;
  fecha_contestada: string | null;
  fecha_fin: string | null;
  duracion_segundos: number | null;
  eventos_count: number;
  evidencia_key: string | null;
}

interface CircuitSnapshot {
  name: string;
  state: string;
  failures: number;
  openedAt: string | null;
  nextRetryAt: string | null;
  failureThreshold: number;
}

interface SupplierStatus {
  supplier: DemoSupplier;
  label: string;
  role: string;
  ok: boolean;
  error: string | null;
  circuit: CircuitSnapshot;
  demoFailure: boolean;
}

interface DemoFailure {
  supplier: DemoSupplier;
  enabled: boolean;
  since: string | null;
}

interface CallCenterConfig {
  dialerUrl: string;
  transcriptionUrl: string;
  metricsUrl: string;
  defaultAgentExtension: string;
  stateStore: string;
  transcriptStore: string;
  asteriskControl: string;
  security: {
    sensitiveMasking: string;
    transcriptEncryption: string;
    recordingEncryptionMode: string;
    voiceSegmentation: string;
  };
}

interface CallCenterServiceStatus {
  supplier: DemoSupplier;
  label: string;
  role: string;
  ok: boolean;
  error: string | null;
  circuit: CircuitSnapshot;
}

interface CallCenterHealth {
  ok: boolean;
  config: CallCenterConfig;
  services: CallCenterServiceStatus[];
}

interface CallCenterMetrics {
  leadsTotal: number;
  leadsPending: number;
  callsTotal: number;
  callsDialing: number;
  callsAnswered: number;
  callsFailed: number;
  answerRatePercent: number;
  transcriptsTotal: number;
  salesOpportunities: number;
  sensitiveMasked: number;
  averageQualityScore: number;
}

interface CallCenterLead {
  id: string;
  name: string;
  phone: string;
  priority: string | number;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

interface CallCenterTranscript {
  _id: string;
  callId: string;
  leadName: string | null;
  agentExtension: string | null;
  recordingFile: string | null;
  maskedText: string;
  sensitiveDataMasked: boolean;
  sensitiveHits: number;
  recordingSecurity?: {
    mode: string;
    encryptedArchiveReady: boolean;
    sha256: string;
  };
  analysis: {
    opportunity: boolean;
    opportunityScore: number;
    qualityScore: number;
    keywords: string[];
    objections: string[];
    summary: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface CallCenterOverview {
  health: CallCenterHealth;
  metrics: CallCenterMetrics | null;
  leads: {
    pending: number;
    nextLead: CallCenterLead | null;
    leads: CallCenterLead[];
  };
  transcripts: {
    transcripts: CallCenterTranscript[];
  };
  at: string;
}

interface ExtensionRuntimeStatus {
  extension: string;
  nombre?: string;
  area?: string | null;
  usuarioEstado?: string;
  technology: string;
  status: string;
  reachable: boolean | null;
  lastEventAt: string | null;
}

interface AuthConfig {
  enabled: boolean;
  usernameHint: string | null;
  tokenTtlSeconds: number;
  defaultCredentials: boolean;
}

interface Health {
  ok: boolean;
  db: { ok: boolean; error: string | null; circuit: CircuitSnapshot };
  floci: {
    ok: boolean;
    enabled: boolean;
    endpoint: string;
    queueName: string;
    queueUrl: string | null;
    bucketName: string;
    bucketReady: boolean;
    circuit: CircuitSnapshot;
    lastError: string | null;
    sqs: { ok: boolean; circuit: CircuitSnapshot; lastError: string | null; queueUrl: string | null };
    s3: { ok: boolean; circuit: CircuitSnapshot; lastError: string | null; bucketName: string; bucketReady: boolean };
  };
  ami: {
    enabled: boolean;
    ok: boolean;
    connected: boolean;
    host: string;
    port: number;
    lastEventAt: string | null;
    lastError: string | null;
    circuit: CircuitSnapshot;
  };
  cdr: {
    enabled: boolean;
    ok: boolean;
    error: string | null;
    host: string;
    database: string;
  };
  sli: SliConfig;
  callCenter: CallCenterHealth;
  provisioner: {
    enabled: boolean;
    configured: boolean;
    ok: boolean;
    error: string | null;
    version: string | null;
    network?: {
      externip?: string | null;
      localnets?: unknown;
      rtpstart?: string | number | null;
      rtpend?: string | number | null;
    } | null;
  };
  recording: {
    enabled: boolean;
    path: string;
  };
  auth: AuthConfig;
  extensions: ExtensionRuntimeStatus[];
  demoFailures: DemoFailure[];
  suppliers: SupplierStatus[];
  at: string;
}

interface SliConfig {
  localLatency: {
    name: string;
    description: string;
    sloMs: number;
    targetPercent: number;
    sampleWindow: number;
  };
}

interface RecordingSummary {
  calldate: string;
  src: string;
  dst: string;
  duration: number;
  billsec: number;
  disposition: string;
  uniqueid: string;
  linkedid: string;
  recordingfile: string;
  file: string;
  available: boolean;
  sizeBytes: number | null;
  downloadUrl: string | null;
}

interface AuditAction {
  id: number;
  actor: string;
  accion: string;
  entidad: string | null;
  entidad_id: string | null;
  detalle: Record<string, unknown> | null;
  creado_en: string;
}

interface Observability {
  metrics: {
    startedAt: string;
    uptimeSeconds: number;
    requestCount: number;
    errorCount: number;
    averageRequestMs: number;
    callEvents: number;
    lastRequestAt: string | null;
    lastCallEventAt: string | null;
  };
  sli: SliConfig;
  callStats: {
    total: number;
    active: number;
    withEvidence: number;
    evidenceCoveragePercent: number;
    recentTotal: number;
    recentWithEvidence: number;
    recentEvidenceCoveragePercent: number;
    averageDurationSeconds: number | null;
    lastCallAt: string | null;
  };
  cdr: Health["cdr"];
  callCenter: CallCenterHealth | null;
  recording: Health["recording"];
  recordings: RecordingSummary[];
  audit: AuditAction[];
  events: Array<{
    id: number;
    at: string;
    level: string;
    type: string;
    message: string;
  }>;
  at: string;
}

interface UsuarioForm {
  nombre: string;
  extension: string;
  procedencia: string;
  area: string;
  sipSecret: string;
  provisionFreepbx: boolean;
  recordCalls: boolean;
}

interface NetworkForm {
  lanIp: string;
  lanCidr: string;
}

interface ManualDialForm {
  company: string;
  client: string;
}

interface LoginForm {
  username: string;
  password: string;
}

interface WebphoneConfig {
  extension: string;
  password: string;
  server: string;
  aorHost: string;
}

type WebphoneCallMode = "audio" | "video";
type WebphoneSessionDirection = "idle" | "incoming" | "outgoing";
type WebphoneSession = Invitation | Inviter;

interface WebphoneRuntime {
  userAgent: UserAgent;
  registerer: Registerer;
  session: WebphoneSession | null;
}

const emptyForm: UsuarioForm = {
  nombre: "",
  extension: "",
  procedencia: "",
  area: "",
  sipSecret: "",
  provisionFreepbx: true,
  recordCalls: true
};
const emptyNetworkForm: NetworkForm = {
  lanIp: "",
  lanCidr: "16"
};
const emptyManualDialForm: ManualDialForm = {
  company: "",
  client: ""
};
const activeCallMaxAgeMs = 8 * 60 * 60 * 1000;
const webphoneSignalMaxAgeMs = 90 * 1000;
const tokenStorageKey = "telefonia_auth_token";
const tablePageSize = 15;

export function App() {
  const [authConfigState, setAuthConfigState] = useState<AuthConfig | null>(null);
  const [token, setToken] = useState(() => window.localStorage.getItem(tokenStorageKey));
  const [loginForm, setLoginForm] = useState<LoginForm>({ username: "admin", password: "" });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [llamadas, setLlamadas] = useState<Llamada[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [observability, setObservability] = useState<Observability | null>(null);
  const [callCenter, setCallCenter] = useState<CallCenterOverview | null>(null);
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionRuntimeStatus[]>([]);
  const [socketState, setSocketState] = useState("CONNECTING");
  const [form, setForm] = useState<UsuarioForm>(emptyForm);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingExtension, setEditingExtension] = useState<string | null>(null);
  const [networkForm, setNetworkForm] = useState<NetworkForm>(emptyNetworkForm);
  const [networkNotice, setNetworkNotice] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [applyingNetwork, setApplyingNetwork] = useState(false);
  const [detectingNetwork, setDetectingNetwork] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialingLead, setDialingLead] = useState(false);
  const [analyzingText, setAnalyzingText] = useState(false);
  const [callCenterNotice, setCallCenterNotice] = useState<string | null>(null);
  const [callCenterError, setCallCenterError] = useState<string | null>(null);
  const [directCallOrigin, setDirectCallOrigin] = useState("1099");
  const [manualDial, setManualDial] = useState<ManualDialForm>(emptyManualDialForm);
  const [callingTarget, setCallingTarget] = useState<string | null>(null);
  const [togglingSupplier, setTogglingSupplier] = useState<DemoSupplier | null>(null);
  const [page, setPage] = useState(1);
  const [activeNav, setActiveNav] = useState("resumen");
  const [webphoneConfig, setWebphoneConfig] = useState<WebphoneConfig>(() => buildDefaultWebphoneConfig());
  const [webphoneStatus, setWebphoneStatus] = useState("DESCONECTADO");
  const [webphoneRegistered, setWebphoneRegistered] = useState(false);
  const [webphoneInCall, setWebphoneInCall] = useState(false);
  const [webphoneIncoming, setWebphoneIncoming] = useState(false);
  const [webphoneCanAnswer, setWebphoneCanAnswer] = useState(false);
  const [webphoneBusy, setWebphoneBusy] = useState(false);
  const [webphoneNotice, setWebphoneNotice] = useState<string | null>(null);
  const [webphoneError, setWebphoneError] = useState<string | null>(null);
  const [webphoneCallMode, setWebphoneCallMode] = useState<WebphoneCallMode>("audio");
  const webphoneRef = useRef<WebphoneRuntime | null>(null);
  const outgoingWebphoneCallRef = useRef(false);
  const webphoneSessionDirectionRef = useRef<WebphoneSessionDirection>("idle");
  const webphoneSessionPollRef = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const webphoneLastSessionStateRef = useRef<string | null>(null);
  const webphoneExpectedInviteTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const localMediaStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const activeCalls = useMemo(
    () =>
      llamadas.filter(
        (call) =>
          !call.fecha_fin &&
          !hasTerminalSibling(call, llamadas) &&
          Date.now() - new Date(call.fecha_inicio).getTime() < activeCallMaxAgeMs &&
          ["RINGING", "ANSWERED", "NEWCHANNEL"].includes(call.estado)
      ),
    [llamadas]
  );
  const recentWebphoneSignalCalls = useMemo(
    () =>
      activeCalls.filter((call) => Date.now() - new Date(call.fecha_inicio).getTime() < webphoneSignalMaxAgeMs),
    [activeCalls]
  );
  const activeWebphoneIncomingCall = useMemo(
    () => recentWebphoneSignalCalls.find((call) => isIncomingCallForExtension(call, webphoneConfig.extension)) ?? null,
    [recentWebphoneSignalCalls, webphoneConfig.extension]
  );
  const activeWebphoneCall = useMemo(
    () => activeCalls.find((call) => isCallForExtension(call, webphoneConfig.extension)) ?? null,
    [activeCalls, webphoneConfig.extension]
  );

  const totalPages = Math.max(1, Math.ceil(llamadas.length / tablePageSize));
  const visibleCalls = llamadas.slice((page - 1) * tablePageSize, page * tablePageSize);
  const recordings = observability?.recordings ?? [];
  const audit = observability?.audit ?? [];
  const isAuthorized = authConfigState !== null && (!authConfigState.enabled || Boolean(token));

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);

      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const response = await fetch(`${API_URL}${path}`, { ...init, headers });

      if (response.status === 401) {
        window.localStorage.removeItem(tokenStorageKey);
        setToken(null);
      }

      return response;
    },
    [token]
  );

  useEffect(() => {
    void fetch(`${API_URL}/api/auth/config`)
      .then((response) => response.json())
      .then((config: AuthConfig) => {
        setAuthConfigState(config);
        setLoginForm((current) => ({ ...current, username: config.usernameHint ?? current.username }));
      })
      .catch(() => setAuthConfigState({ enabled: false, usernameHint: null, tokenTtlSeconds: 0, defaultCredentials: false }));
  }, []);

  const loadData = useCallback(async () => {
    if (!isAuthorized) {
      return;
    }

    const [usersResponse, callsResponse, healthResponse, extensionsResponse, observabilityResponse, callCenterResponse] = await Promise.all([
      apiFetch("/api/users"),
      apiFetch("/api/calls?limit=80"),
      apiFetch("/api/health"),
      apiFetch("/api/extensions/status"),
      apiFetch("/api/observability"),
      apiFetch("/api/call-center/overview")
    ]);

    if (
      ![usersResponse, callsResponse, healthResponse, extensionsResponse, observabilityResponse, callCenterResponse].every(
        (response) => response.ok
      )
    ) {
      return;
    }

    setUsuarios(await usersResponse.json());
    setLlamadas(await callsResponse.json());
    setHealth(await healthResponse.json());
    setExtensionStatuses(await extensionsResponse.json());
    setObservability(await observabilityResponse.json());
    setCallCenter(await callCenterResponse.json());
  }, [apiFetch, isAuthorized]);

  useEffect(() => {
    if (!isAuthorized) {
      return undefined;
    }

    void loadData();
    const interval = window.setInterval(() => {
      void loadData().catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [isAuthorized, loadData]);

  useEffect(() => {
    if (!isAuthorized) {
      return undefined;
    }

    let closed = false;
    let retry: number | undefined;
    let socket: WebSocket | null = null;

    const connect = () => {
      const wsUrl = authConfigState?.enabled && token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
      socket = new WebSocket(wsUrl);
      setSocketState("CONNECTING");

      socket.onopen = () => setSocketState("CONNECTED");
      socket.onclose = () => {
        setSocketState("DISCONNECTED");

        if (!closed) {
          retry = window.setTimeout(connect, 2500);
        }
      };
      socket.onerror = () => setSocketState("ERROR");
      socket.onmessage = (message) => {
        const event = JSON.parse(message.data);

        if (event.type === "CALL_EVENT" || event.type === "CALL_UPDATED") {
          setLlamadas((current) => upsertById(current, event.payload));
        }

        if (event.type === "USER_CREATED") {
          setUsuarios((current) => upsertById(current, event.payload).sort(byExtension));
        }

        if (event.type === "USER_UPDATED") {
          setUsuarios((current) => upsertById(current, event.payload).sort(byExtension));
        }

        if (event.type === "WEBPHONE_REMOTE_HANGUP" && event.payload?.extension === webphoneConfig.extension) {
          const runtime = webphoneRef.current;

          if (runtime?.session) {
            runtime.session = null;
          }

          finishWebphoneCall("Llamada finalizada por la otra extension.");
        }
      };
    };

    connect();

    return () => {
      closed = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [authConfigState?.enabled, isAuthorized, token, webphoneConfig.extension]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (
      !webphoneRegistered ||
      webphoneInCall ||
      outgoingWebphoneCallRef.current ||
      webphoneRef.current?.session ||
      !activeWebphoneIncomingCall
    ) {
      return;
    }

    webphoneSessionDirectionRef.current = "incoming";
    setActiveNav("extensiones");
    setWebphoneIncoming(true);
    setWebphoneCanAnswer(false);
    setWebphoneStatus("ENTRANTE");
    setWebphoneNotice(
      `Asterisk detecto una llamada de ${activeWebphoneIncomingCall.nombre_origen ?? activeWebphoneIncomingCall.extension_origen ?? "extension externa"} hacia ${webphoneConfig.extension}. Esperando la invitacion SIP del navegador.`
    );
  }, [activeWebphoneIncomingCall, webphoneConfig.extension, webphoneInCall, webphoneRegistered]);

  useEffect(() => {
    if (!webphoneRegistered) {
      clearExpectedInviteTimer();
      return;
    }

    const runtime = webphoneRef.current;
    const hasSipSession = Boolean(runtime?.session);

    if (activeWebphoneIncomingCall && !hasSipSession && !webphoneExpectedInviteTimerRef.current) {
      webphoneExpectedInviteTimerRef.current = window.setTimeout(() => {
        webphoneExpectedInviteTimerRef.current = null;

        if (webphoneRef.current?.session || !activeWebphoneIncomingCall) {
          return;
        }

        setWebphoneIncoming(false);
        setWebphoneCanAnswer(false);
        setWebphoneStatus("REGISTRADO");
        setWebphoneNotice("La llamada llego a Asterisk, pero el navegador no recibio el INVITE SIP. Reconecta el telefono web 1099 y vuelve a llamar.");
      }, 7000);
      return;
    }

    if (hasSipSession || !activeWebphoneIncomingCall) {
      clearExpectedInviteTimer();
    }
  }, [activeWebphoneIncomingCall, webphoneRegistered]);

  useEffect(() => {
    const runtime = webphoneRef.current;

    if (!webphoneRegistered || !runtime?.session || activeWebphoneCall) {
      return;
    }

    runtime.session = null;
    finishWebphoneCall("Llamada finalizada por la otra extension.");
  }, [activeWebphoneCall, webphoneRegistered]);

  useEffect(() => {
    const externip = health?.provisioner.network?.externip;

    if (externip && !networkForm.lanIp) {
      setNetworkForm((current) => ({ ...current, lanIp: externip }));
    }
  }, [health?.provisioner.network?.externip, networkForm.lanIp]);

  useEffect(() => {
    setWebphoneConfig((current) => normalizeWebphoneConfig(current));
  }, []);

  useEffect(() => {
    return () => {
      const webphone = webphoneRef.current;
      webphoneRef.current = null;

      if (webphone) {
        if (webphone.session) {
          void terminateWebphoneSession(webphone.session).catch(() => undefined);
        }
        void webphone.registerer.unregister().catch(() => undefined);
        void webphone.userAgent.stop().catch(() => undefined);
      }

      stopWebphoneSessionMonitor();
      stopLocalPreview();
    };
  }, []);

  async function submitUser(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormNotice(null);
    setFormError(null);

    try {
      if (editingExtension) {
        const response = await apiFetch(`/api/users/${editingExtension}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: form.nombre,
            procedencia: form.procedencia || null,
            area: form.area || null
          })
        });
        const body = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(body?.error ?? "No se pudo actualizar");
        }

        setForm(emptyForm);
        setEditingExtension(null);
        setFormNotice(`Usuario ${body.extension} actualizado`);
        await loadData();
        return;
      }

      const response = await apiFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre,
          extension: form.extension,
          procedencia: form.procedencia || null,
          area: form.area || null,
          provisionFreepbx: form.provisionFreepbx,
          sipSecret: form.sipSecret || null,
          recordCalls: form.recordCalls
        })
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "No se pudo registrar");
      }

      setForm(emptyForm);
      setFormNotice(
        body?.sipSecret
          ? `Extension ${body.extension} creada. Clave SIP: ${body.sipSecret}`
          : `Usuario ${body.extension} registrado`
      );
      await loadData();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo registrar");
    } finally {
      setSaving(false);
    }
  }

  function startEditingUser(user: Usuario) {
    if (isSimulatedClientExtension(user.extension)) {
      setActiveNav("clientes");
    } else {
      setActiveNav("extensiones");
    }

    setEditingExtension(user.extension);
    setForm({
      nombre: user.nombre,
      extension: user.extension,
      procedencia: user.procedencia ?? "",
      area: user.area ?? "",
      sipSecret: "",
      provisionFreepbx: false,
      recordCalls: true
    });
    setFormNotice(null);
    setFormError(null);
    document.getElementById("usuario-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startEditingExtension(extension: string) {
    const user = usuarios.find((item) => item.extension === extension);

    if (user) {
      startEditingUser(user);
    }
  }

  function startNewClient() {
    setActiveNav("clientes");
    const usedExtensions = new Set(usuarios.map((user) => user.extension));
    let nextExtension = "9001";

    for (let value = 9001; value <= 9999; value += 1) {
      if (!usedExtensions.has(String(value))) {
        nextExtension = String(value);
        break;
      }
    }

    setEditingExtension(null);
    setForm({
      nombre: "",
      extension: nextExtension,
      procedencia: "Red Clientes Simulados",
      area: "Cliente",
      sipSecret: `Telefonia${nextExtension}`,
      provisionFreepbx: true,
      recordCalls: true
    });
    setFormNotice(null);
    setFormError(null);
    document.getElementById("usuario-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEditingUser() {
    setEditingExtension(null);
    setForm(emptyForm);
    setFormNotice(null);
    setFormError(null);
  }

  async function applyTelephonyNetwork(event: FormEvent) {
    event.preventDefault();
    setApplyingNetwork(true);
    setNetworkNotice(null);
    setNetworkError(null);

    try {
      const response = await apiFetch("/api/telephony/network", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lanIp: networkForm.lanIp,
          lanCidr: Number(networkForm.lanCidr)
        })
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "No se pudo aplicar la red");
      }

      setNetworkNotice(`Red aplicada: ${body.lanIp} / ${body.lanNet}/${body.lanCidr}`);
      await loadData();
    } catch (error) {
      setNetworkError(error instanceof Error ? error.message : "No se pudo aplicar la red");
    } finally {
      setApplyingNetwork(false);
    }
  }

  async function detectTelephonyNetwork() {
    setDetectingNetwork(true);
    setNetworkNotice(null);
    setNetworkError(null);

    try {
      const browserHost = window.location.hostname;

      if (isUsableIpv4(browserHost)) {
        const cidr = suggestCidr(browserHost);
        setNetworkForm({ lanIp: browserHost, lanCidr: String(cidr) });
        setNetworkNotice(`IP detectada desde el navegador: ${browserHost}`);
        return;
      }

      const response = await apiFetch("/api/telephony/network/detect");
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "No se pudo detectar la red");
      }

      setNetworkForm({ lanIp: body.lanIp, lanCidr: String(body.lanCidr) });
      setNetworkNotice(
        body.source === "freepbx-config"
          ? `Sugerencia cargada desde FreePBX: ${body.lanIp}`
          : `IP detectada: ${body.lanIp}`
      );
    } catch (error) {
      setNetworkError(error instanceof Error ? error.message : "No se pudo detectar la red");
    } finally {
      setDetectingNetwork(false);
    }
  }

  async function simulateCall() {
    const origen = usuarios[0]?.extension ?? "1001";
    const destino = usuarios.find((user) => user.extension !== origen)?.extension ?? "1002";

    await apiFetch("/api/simulate-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extensionOrigen: origen, extensionDestino: destino })
    });
    await loadData();
  }

  async function endCall(id: number) {
    await apiFetch(`/api/calls/${id}/end`, { method: "POST" });
    await loadData();
  }

  async function originatePanelCall(destination: string, mode: "audio" | "video" = "audio") {
    setCallingTarget(`${mode}:${destination}`);
    setCallCenterNotice(null);
    setCallCenterError(null);

    try {
      if (directCallOrigin === webphoneConfig.extension) {
        const runtime = webphoneRef.current;

        if (!runtime || !webphoneRegistered) {
          throw new Error("Conecta primero el telefono web para usar la extension 1099");
        }

        const destinationUri = UserAgent.makeURI(`sip:${destination}@${webphoneConfig.aorHost}`);

        if (!destinationUri) {
          throw new Error("Destino SIP invalido");
        }

        setWebphoneCallMode(mode);
        outgoingWebphoneCallRef.current = true;
        webphoneSessionDirectionRef.current = "outgoing";
        if (mode === "video") {
          await startLocalPreview();
        } else {
          stopLocalPreview();
        }
        const inviter = new Inviter(runtime.userAgent, destinationUri, {
          sessionDescriptionHandlerOptions: {
            constraints: {
              audio: true,
              video: mode === "video"
            }
          }
        });
        runtime.session = inviter;
        watchWebphoneSession(inviter, "outgoing");
        await inviter.invite();
        setWebphoneInCall(true);
        setWebphoneIncoming(false);
        setWebphoneCanAnswer(false);
        setWebphoneStatus("LLAMANDO");
        setWebphoneNotice(
          `${mode === "video" ? "Videollamada" : "Llamada"} desde ${webphoneConfig.extension} a ${destination} iniciada en el navegador.`
        );
        setCallCenterNotice(
          `${mode === "video" ? "Videollamada" : "Llamada"} ${webphoneConfig.extension} -> ${destination} iniciada desde la laptop.`
        );
        return;
      }

      const response = await apiFetch("/api/calls/originate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extensionOrigen: directCallOrigin,
          extensionDestino: destination,
          mode
        })
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.originate?.response ?? body?.error ?? "No se pudo originar llamada");
      }

      setCallCenterNotice(`${mode === "video" ? "Video llamada" : "Llamada"} ${directCallOrigin} -> ${destination} enviada a Asterisk`);
      await loadData();
    } catch (error) {
      outgoingWebphoneCallRef.current = false;
      webphoneSessionDirectionRef.current = "idle";
      setCallCenterError(error instanceof Error ? error.message : "No se pudo originar llamada");
    } finally {
      setCallingTarget(null);
    }
  }

  async function submitManualDial(event: FormEvent, target: "company" | "client") {
    event.preventDefault();
    const destination = target === "company" ? manualDial.company : manualDial.client;

    if (!destination) {
      return;
    }

    await originatePanelCall(destination, "audio");
  }

  async function toggleFailure(supplier: DemoSupplier, enabled: boolean) {
    setTogglingSupplier(supplier);

    try {
      const response = await apiFetch(`/api/demo/failures/${supplier}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });

      if (response.ok) {
        setHealth(await response.json());
      }
      await loadData();
    } finally {
      setTogglingSupplier(null);
    }
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setLoginError(null);

    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginForm)
    });

    if (!response.ok) {
      setLoginError("Credenciales invalidas");
      return;
    }

    const session = await response.json();

    if (session.token) {
      window.localStorage.setItem(tokenStorageKey, session.token);
      setToken(session.token);
    }
  }

  function logout() {
    window.localStorage.removeItem(tokenStorageKey);
    setToken(null);
    setUsuarios([]);
    setLlamadas([]);
    setHealth(null);
    setObservability(null);
    setCallCenter(null);
    setExtensionStatuses([]);
  }

  async function dialNextLeadAction() {
    setDialingLead(true);
    setCallCenterNotice(null);
    setCallCenterError(null);

    try {
      const agentExtension = callCenter?.health.config.defaultAgentExtension ?? health?.callCenter.config.defaultAgentExtension ?? "1001";
      const response = await apiFetch("/api/call-center/dial-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentExtension })
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.detail ?? body?.error ?? "No se pudo iniciar la marcacion");
      }

      setCallCenterNotice(
        body?.ok
          ? `Marcacion enviada a Asterisk para ${body?.lead?.name ?? "lead"} desde agente ${agentExtension}.`
          : body?.message ?? "No hay leads pendientes para marcar."
      );
      await loadData();
    } catch (error) {
      setCallCenterError(error instanceof Error ? error.message : "No se pudo iniciar la marcacion");
    } finally {
      setDialingLead(false);
    }
  }

  async function analyzeDemoText() {
    setAnalyzingText(true);
    setCallCenterNotice(null);
    setCallCenterError(null);

    try {
      const response = await apiFetch("/api/call-center/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId: `demo-${Date.now()}`,
          leadName: "Cliente demo",
          agentExtension: callCenter?.health.config.defaultAgentExtension ?? "1001",
          text:
            "El cliente pide precio, demo y plan empresarial. Menciona la tarjeta 4111 1111 1111 1111 para validar el enmascaramiento automatico."
        })
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "No se pudo analizar la llamada");
      }

      setCallCenterNotice(
        body?.transcript?.analysis?.opportunity
          ? "Transcripcion guardada en MongoDB: oportunidad comercial detectada y datos sensibles enmascarados."
          : "Transcripcion guardada en MongoDB."
      );
      await loadData();
    } catch (error) {
      setCallCenterError(error instanceof Error ? error.message : "No se pudo analizar la llamada");
    } finally {
      setAnalyzingText(false);
    }
  }

  async function downloadReport() {
    const response = await apiFetch("/api/demo/report");

    if (!response.ok) {
      return;
    }

    const report = await response.json();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reporte-demo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function downloadRecording(recording: RecordingSummary) {
    if (!recording.downloadUrl) {
      return;
    }

    const response = await apiFetch(recording.downloadUrl);

    if (!response.ok) {
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = recording.file;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const companyExtensions = extensionStatuses.filter((extension) => !isSimulatedClientExtension(extension.extension));
  const clientExtensions = extensionStatuses.filter((extension) => isSimulatedClientExtension(extension.extension));
  const companyQuickDial = buildCompanyQuickDial(companyExtensions);
  const clientQuickDial = clientExtensions;
  const callCenterHealth = callCenter?.health ?? health?.callCenter ?? observability?.callCenter ?? null;
  const networkPreview = previewNetwork(networkForm.lanIp, Number(networkForm.lanCidr));
  const usingWebphoneOrigin = directCallOrigin === webphoneConfig.extension;

  const statusCards = [
    {
      icon: <Database size={25} />,
      title: "PostgreSQL",
      state: health?.db.ok ? "OK" : "FALLA",
      leftLabel: "Latency",
      leftValue: `${Math.round(observability?.metrics.averageRequestMs ?? 0)} ms`,
      rightLabel: "Ultima verificacion",
      rightValue: formatTime(health?.at)
    },
    {
      icon: <RadioTower size={25} />,
      title: "Asterisk AMI",
      state: health?.ami.connected ? "OK" : "FALLA",
      leftLabel: "Sesiones",
      leftValue: health?.ami.connected ? "1" : "0",
      rightLabel: "Ultima verificacion",
      rightValue: formatTime(health?.at)
    },
    {
      icon: <Cloud size={25} />,
      title: "Floci SQS",
      state: health?.floci.sqs.ok ? "OK" : "FALLA",
      leftLabel: "Eventos",
      leftValue: observability?.metrics.callEvents ?? 0,
      rightLabel: "Ultima verificacion",
      rightValue: formatTime(health?.at)
    },
    {
      icon: <FileText size={25} />,
      title: "Floci S3",
      state: health?.floci.s3.ok ? "OK" : "FALLA",
      leftLabel: "Objetos",
      leftValue: observability?.callStats.withEvidence ?? 0,
      rightLabel: "Ultima verificacion",
      rightValue: formatTime(health?.at)
    },
    {
      icon: <BarChart3 size={25} />,
      title: "Asterisk CDR",
      state: health?.cdr.ok ? "OK" : "FALLA",
      leftLabel: "Registros hoy",
      leftValue: observability?.callStats.recentTotal ?? 0,
      rightLabel: "Grabaciones",
      rightValue: recordings.length
    },
    {
      icon: <Server size={25} />,
      title: "WebSocket",
      state: socketState === "CONNECTED" ? "CONECTADO" : socketState,
      leftLabel: "Sesiones",
      leftValue: socketState === "CONNECTED" ? "1" : "0",
      rightLabel: "Ultima verificacion",
      rightValue: formatTime(observability?.at)
    }
  ];

  function navigateToSection(sectionId: string) {
    setActiveNav(sectionId);
  }

  async function connectWebphone() {
    const config = normalizeWebphoneConfig(webphoneConfig);

    if (config.server !== webphoneConfig.server || config.aorHost !== webphoneConfig.aorHost) {
      setWebphoneConfig(config);
    }

    setWebphoneBusy(true);
    setWebphoneError(null);
    setWebphoneNotice(null);

    try {
      if (!remoteAudioRef.current || !localVideoRef.current || !remoteVideoRef.current) {
        throw new Error("No se encontraron los elementos multimedia del navegador");
      }

      if (webphoneRef.current) {
        await disconnectWebphone();
      }

      const uri = UserAgent.makeURI(`sip:${config.extension}@${config.aorHost}`);

      if (!uri) {
        throw new Error("Direccion SIP invalida para el telefono web");
      }

      const userAgent = new UserAgent({
        uri,
        authorizationUsername: config.extension,
        authorizationPassword: config.password,
        contactName: config.extension,
        displayName: "Operador Web",
        transportOptions: {
          server: config.server,
          connectionTimeout: 5,
          keepAliveInterval: 20,
          keepAliveDebounce: 5,
          traceSip: true
        },
        delegate: {
          onInvite: (invitation) => {
            const runtime = webphoneRef.current;

            if (!runtime) {
              void invitation.reject().catch(() => undefined);
              return;
            }

            runtime.session = invitation;
            outgoingWebphoneCallRef.current = false;
            webphoneSessionDirectionRef.current = "incoming";
            setActiveNav("extensiones");
            setWebphoneIncoming(true);
            setWebphoneCanAnswer(true);
            setWebphoneInCall(false);
            setWebphoneStatus("ENTRANTE");
            setWebphoneNotice(`Llamada entrante de ${invitation.remoteIdentity.displayName || invitation.remoteIdentity.uri.user || "extension externa"}.`);
            watchWebphoneSession(invitation, "incoming");
            void invitation.progress().catch(() => undefined);
          },
          onConnect: () => {
            setWebphoneStatus("CONECTADO");
          },
          onDisconnect: (error?: Error) => {
            outgoingWebphoneCallRef.current = false;
            webphoneSessionDirectionRef.current = "idle";
            setWebphoneRegistered(false);
            setWebphoneInCall(false);
            setWebphoneIncoming(false);
            setWebphoneCanAnswer(false);
            setWebphoneStatus("DESCONECTADO");

            if (error) {
              setWebphoneError(error.message);
            }
          }
        }
      });
      const registerer = new Registerer(userAgent, {
        expires: 120,
        refreshFrequency: 75
      });
      const webphone: WebphoneRuntime = { userAgent, registerer, session: null };

      registerer.stateChange.addListener((state) => {
        if (state === "Registered") {
          setWebphoneRegistered(true);
          setWebphoneStatus("REGISTRADO");
          setWebphoneNotice(`Telefono web ${config.extension} registrado.`);
        }

        if (state === "Unregistered" || state === "Terminated") {
          outgoingWebphoneCallRef.current = false;
          webphoneSessionDirectionRef.current = "idle";
          setWebphoneRegistered(false);
          setWebphoneInCall(false);
          setWebphoneIncoming(false);
          setWebphoneCanAnswer(false);
          setWebphoneStatus("DESCONECTADO");
        }
      });

      webphoneRef.current = webphone;
      await userAgent.start();
      await registerer.register();
      setWebphoneRegistered(true);
      setWebphoneStatus("REGISTRADO");
      setWebphoneNotice(`Telefono web ${config.extension} registrado.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo conectar el telefono web";
      setWebphoneError(message);
      setWebphoneStatus("ERROR");
    } finally {
      setWebphoneBusy(false);
    }
  }

  async function disconnectWebphone() {
    const webphone = webphoneRef.current;
    webphoneRef.current = null;
    outgoingWebphoneCallRef.current = false;
    webphoneSessionDirectionRef.current = "idle";
    stopWebphoneSessionMonitor();
    clearExpectedInviteTimer();

    if (!webphone) {
      setWebphoneRegistered(false);
      setWebphoneInCall(false);
      setWebphoneIncoming(false);
      setWebphoneCanAnswer(false);
      setWebphoneStatus("DESCONECTADO");
      return;
    }

    setWebphoneBusy(true);
    setWebphoneError(null);

    try {
      if (webphone.session) {
        await terminateWebphoneSession(webphone.session).catch(() => undefined);
        webphone.session = null;
      }
      await webphone.registerer.unregister().catch(() => undefined);
      await webphone.userAgent.stop().catch(() => undefined);
      stopLocalPreview();
      outgoingWebphoneCallRef.current = false;
      webphoneSessionDirectionRef.current = "idle";
      setWebphoneRegistered(false);
      setWebphoneInCall(false);
      setWebphoneIncoming(false);
      setWebphoneCanAnswer(false);
      setWebphoneStatus("DESCONECTADO");
      setWebphoneNotice("Telefono web desconectado.");
    } catch (error) {
      setWebphoneError(error instanceof Error ? error.message : "No se pudo desconectar el telefono web");
    } finally {
      setWebphoneBusy(false);
    }
  }

  async function startLocalPreview() {
    if (!localVideoRef.current) {
      return;
    }

    stopLocalPreview();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: { ideal: 640 },
          height: { ideal: 360 },
          facingMode: "user"
        }
      });

      localMediaStreamRef.current = stream;
      localVideoRef.current.srcObject = stream;
      await localVideoRef.current.play().catch(() => undefined);
    } catch (error) {
      const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localMediaStreamRef.current = audioOnly;
      localVideoRef.current.srcObject = null;
      setWebphoneNotice("Microfono activo. La camara no pudo abrirse en este navegador.");

      if (error instanceof Error) {
        setWebphoneError(error.message);
      }
    }
  }

  function stopLocalPreview() {
    localMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    localMediaStreamRef.current = null;

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }

  function attachWebphoneSessionMedia(session: WebphoneSession) {
    const handler = session.sessionDescriptionHandler as
      | {
          localMediaStream?: MediaStream;
          remoteMediaStream?: MediaStream;
        }
      | undefined;

    if (handler?.localMediaStream && localVideoRef.current) {
      localVideoRef.current.srcObject = handler.localMediaStream;
      void localVideoRef.current.play().catch(() => undefined);
    }

    if (handler?.remoteMediaStream && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = handler.remoteMediaStream;
      void remoteAudioRef.current.play().catch(() => undefined);
    }

    if (handler?.remoteMediaStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = handler.remoteMediaStream;
      void remoteVideoRef.current.play().catch(() => undefined);
    }
  }

  async function terminateWebphoneSession(session: WebphoneSession) {
    if (session.state === SessionState.Established) {
      await session.bye();
      return;
    }

    if (session instanceof Invitation) {
      await session.reject().catch(() => session.dispose());
      return;
    }

    if (session instanceof Inviter) {
      await session.cancel().catch(() => session.dispose());
      return;
    }
  }

  function stopWebphoneSessionMonitor() {
    if (webphoneSessionPollRef.current) {
      window.clearInterval(webphoneSessionPollRef.current);
      webphoneSessionPollRef.current = null;
    }

    webphoneLastSessionStateRef.current = null;
  }

  function watchWebphoneSession(session: WebphoneSession, direction: WebphoneSessionDirection) {
    webphoneLastSessionStateRef.current = session.state;

    session.stateChange.addListener((state) => {
      const runtime = webphoneRef.current;

      if (!runtime || runtime.session !== session) {
        return;
      }

      webphoneLastSessionStateRef.current = state;

      if (state === SessionState.Establishing) {
        setWebphoneStatus(direction === "outgoing" ? "LLAMANDO" : "ENTRANTE");
        return;
      }

      if (state === SessionState.Established) {
        outgoingWebphoneCallRef.current = false;
        setWebphoneIncoming(false);
        setWebphoneCanAnswer(false);
        setWebphoneInCall(true);
        setWebphoneStatus("EN LLAMADA");
        attachWebphoneSessionMedia(session);
        return;
      }

      if (state === SessionState.Terminating || state === SessionState.Terminated) {
        runtime.session = null;
        finishWebphoneCall("Llamada finalizada.");
      }
    });
  }

  function clearExpectedInviteTimer() {
    if (webphoneExpectedInviteTimerRef.current) {
      window.clearTimeout(webphoneExpectedInviteTimerRef.current);
      webphoneExpectedInviteTimerRef.current = null;
    }
  }

  function finishWebphoneCall(message: string) {
    outgoingWebphoneCallRef.current = false;
    webphoneSessionDirectionRef.current = "idle";
    clearExpectedInviteTimer();
    stopLocalPreview();
    setWebphoneIncoming(false);
    setWebphoneCanAnswer(false);
    setWebphoneInCall(false);
    setWebphoneStatus(webphoneRef.current ? "REGISTRADO" : "CONECTADO");
    setWebphoneNotice(message);
  }

  async function answerWebphoneCall() {
    await answerWebphoneCallWithMode("audio");
  }

  async function answerWebphoneCallWithMode(mode: WebphoneCallMode) {
    const runtime = webphoneRef.current;

    if (!runtime) {
      return;
    }

    setWebphoneBusy(true);
    setWebphoneError(null);

    try {
      const invitation = runtime.session instanceof Invitation ? runtime.session : null;

      if (!invitation) {
        throw new Error("No hay INVITE SIP activo en esta pestaña. Cierra otras pestañas del panel, pulsa Desconectar y vuelve a Conectar el telefono web 1099.");
      }

      if (webphoneSessionDirectionRef.current === "idle") {
        webphoneSessionDirectionRef.current = "incoming";
      }
      setWebphoneCallMode(mode);
      setWebphoneCanAnswer(false);
      if (mode === "video") {
        await startLocalPreview();
      } else {
        stopLocalPreview();
      }
      await invitation.accept({
        sessionDescriptionHandlerOptions: {
          constraints: {
            audio: true,
            video: mode === "video"
          }
        }
      });
      setWebphoneIncoming(false);
      setWebphoneCanAnswer(false);
      setWebphoneInCall(true);
      setWebphoneStatus("EN LLAMADA");
      setWebphoneNotice(`Llamada respondida en modo ${mode === "video" ? "video" : "audio"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo responder la llamada";
      setWebphoneError(message);
    } finally {
      setWebphoneBusy(false);
    }
  }

  async function hangupWebphoneCall() {
    const runtime = webphoneRef.current;

    if (!runtime) {
      return;
    }

    setWebphoneBusy(true);
    setWebphoneError(null);

    try {
      if (runtime.session) {
        await terminateWebphoneSession(runtime.session);
        runtime.session = null;
      }
      finishWebphoneCall("Llamada finalizada.");
    } catch (error) {
      setWebphoneError(error instanceof Error ? error.message : "No se pudo colgar la llamada");
    } finally {
      setWebphoneBusy(false);
    }
  }

  if (!authConfigState) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <Shield size={28} />
          <h1>Sistema de Telefonia</h1>
          <p>Inicializando seguridad</p>
        </section>
      </main>
    );
  }

  if (authConfigState.enabled && !token) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={(event) => void submitLogin(event)}>
          <Shield size={30} />
          <div>
            <p className="eyebrow">Acceso protegido</p>
            <h1>Sistema de Telefonia</h1>
          </div>
          <label>
            Usuario
            <input
              required
              value={loginForm.username}
              onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              value={loginForm.password}
              onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
            />
          </label>
          {loginError && <p className="form-error">{loginError}</p>}
          <button className="primary-button full" type="submit">
            <LogIn size={18} />
            Entrar
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className={`app-frame view-${activeNav}`}>
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-icon">
            <Phone size={20} />
          </div>
          <div>
            <strong>PBX LOCAL</strong>
            <span>CON RESILIENCIA</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="Principal">
          <SidebarItem active={activeNav === "resumen"} icon={<Home size={20} />} label="Resumen" onClick={() => navigateToSection("resumen")} />
          <SidebarItem active={activeNav === "llamadas"} icon={<PhoneCall size={20} />} label="Llamadas" onClick={() => navigateToSection("llamadas")} />
          <SidebarItem active={activeNav === "extensiones"} icon={<SlidersHorizontal size={20} />} label="Empresa" onClick={() => navigateToSection("extensiones")} />
          <SidebarItem active={activeNav === "clientes"} icon={<Users size={20} />} label="Clientes" onClick={() => navigateToSection("clientes")} />
          <SidebarItem active={activeNav === "proveedores"} icon={<Settings size={20} />} label="Proveedores" onClick={() => navigateToSection("proveedores")} />
          <SidebarItem active={activeNav === "usuarios"} icon={<Users size={20} />} label="Usuarios" onClick={() => navigateToSection("usuarios")} />
          <SidebarItem active={activeNav === "configuracion"} icon={<RadioTower size={20} />} label="Red SIP/RTP" onClick={() => navigateToSection("configuracion")} />
          <SidebarItem active={activeNav === "grabaciones"} icon={<FileAudio size={20} />} label="Grabaciones" onClick={() => navigateToSection("grabaciones")} />
          <SidebarItem active={activeNav === "auditoria"} icon={<Shield size={20} />} label="Auditoria" onClick={() => navigateToSection("auditoria")} />
          <SidebarItem icon={<FileText size={20} />} label="Reporte" onClick={() => void downloadReport()} />
        </nav>

        <button className="operator-card" type="button" onClick={logout}>
          <span className="operator-avatar">
            <UserRound size={18} />
          </span>
          <span>
            <strong>Operador</strong>
            <small>Administrador</small>
          </span>
          {authConfigState.enabled && <LogOut size={17} />}
        </button>
      </aside>

      <section className="workspace">
        <header className="workspace-header" id="resumen">
          <h1>Sistema de Telefonia</h1>
          <div className="header-actions">
            <button className="secondary-button" type="button" onClick={() => void downloadReport()}>
              <Download size={18} />
              Reporte
            </button>
            <button className="icon-button" type="button" onClick={() => void loadData()} aria-label="Actualizar">
              <RefreshCw size={18} />
            </button>
            {authConfigState.enabled && (
              <button className="icon-button" type="button" onClick={logout} aria-label="Cerrar sesion">
                <LogOut size={18} />
              </button>
            )}
          </div>
        </header>

        <section className="status-grid" aria-label="Estado de servicios">
          {statusCards.map((card) => (
            <StatusTile key={card.title} {...card} />
          ))}
        </section>

        <section className="direct-call-toolbar" aria-label="Marcacion directa">
          <label>
            Origen PBX
            <select value={directCallOrigin} onChange={(event) => setDirectCallOrigin(event.target.value)}>
              {companyExtensions.map((extension) => (
                <option key={extension.extension} value={extension.extension}>
                  {extension.extension} - {extension.nombre ?? extension.area ?? "Empresa"}
                </option>
              ))}
            </select>
          </label>
          <span>
            {usingWebphoneOrigin
              ? "1099 es el puesto fijo de esta laptop. Usa microfono y camara del navegador."
              : `${directCallOrigin || "1099"} origina la llamada desde Asterisk. 1001 corresponde a tu celular/Linphone si lo registras.`}
          </span>
        </section>

        {webphoneIncoming && (
          <section className="incoming-call-banner" aria-live="assertive">
            <div>
              <strong>Llamada entrante en {webphoneConfig.extension}</strong>
              <span>
                {webphoneCanAnswer
                  ? "Responde desde el telefono web de la laptop."
                  : "La central la detecto, pero esta pestaña aun no recibio la sesion SIP."}
              </span>
            </div>
            <button className="primary-button compact-action" type="button" disabled={webphoneBusy || !webphoneCanAnswer} onClick={() => void answerWebphoneCall()}>
              <PhoneCall size={16} />
              Responder
            </button>
            <button className="secondary-button compact-action" type="button" disabled={webphoneBusy || !webphoneCanAnswer} onClick={() => void answerWebphoneCallWithMode("video")}>
              <Video size={16} />
              Video
            </button>
          </section>
        )}

        <section className="dashboard-grid">
          <div className="main-column">
            <section className="top-panels">
              <Panel id="proveedores" title="Circuit breaker - proveedores" icon={<Settings size={20} />} className="circuit-panel">
                <div className="circuit-list">
                  {(health?.suppliers ?? []).map((supplier) => (
                    <div className="circuit-row" key={supplier.supplier}>
                      <ProviderIcon supplier={supplier.supplier} />
                      <div className="row-main">
                        <strong>{supplier.label}</strong>
                        <span>{supplier.role}</span>
                      </div>
                      <StatusPill value={supplier.circuit.state} />
                      <span className="circuit-count">
                        {supplier.circuit.failures}/{supplier.circuit.failureThreshold}
                      </span>
                      <button
                        className="fault-button"
                        type="button"
                        disabled={togglingSupplier === supplier.supplier}
                        onClick={() => void toggleFailure(supplier.supplier, !supplier.demoFailure)}
                      >
                        {supplier.demoFailure ? "Recuperar" : "Fallar"}
                      </button>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel id="extensiones" title="Red privada 1 - Empresa / Call Center" icon={<Headphones size={20} />} className="softphone-panel">
                <div className="dial-section">
                  <WebphonePanel
                    config={webphoneConfig}
                    status={webphoneStatus}
                    registered={webphoneRegistered}
                    inCall={webphoneInCall}
                    incoming={webphoneIncoming}
                    canAnswer={webphoneCanAnswer}
                    busy={webphoneBusy}
                    notice={webphoneNotice}
                    error={webphoneError}
                    mode={webphoneCallMode}
                    localVideoRef={localVideoRef}
                    remoteVideoRef={remoteVideoRef}
                    onChange={setWebphoneConfig}
                    onConnect={() => void connectWebphone()}
                    onDisconnect={() => void disconnectWebphone()}
                    onAnswer={() => void answerWebphoneCall()}
                    onAnswerVideo={() => void answerWebphoneCallWithMode("video")}
                    onHangup={() => void hangupWebphoneCall()}
                  />
                  <QuickDialGrid
                    title="Marcacion rapida por area"
                    subtitle="Selecciona el area interna y Asterisk conectara desde la extension origen."
                    entries={companyQuickDial}
                    callingTarget={callingTarget}
                    onCall={(extension, mode) => void originatePanelCall(extension, mode)}
                  />
                  <ManualDialBox
                    title="Marcacion interna manual"
                    value={manualDial.company}
                    placeholder="Ej. 1001, 2001, 3001"
                    onChange={(value) => setManualDial((current) => ({ ...current, company: value }))}
                    onSubmit={(event) => void submitManualDial(event, "company")}
                  />
                  <ExtensionZone
                    title="Directorio empresa"
                    subtitle="Extensiones internas disponibles en la red privada del call center"
                    extensions={companyExtensions}
                    callingTarget={callingTarget}
                    onCall={(extension, mode) => void originatePanelCall(extension, mode)}
                    onEdit={startEditingExtension}
                  />
                </div>
              </Panel>

              <Panel id="clientes" title="Red privada 2 - Clientes simulados" icon={<Users size={20} />} className="softphone-panel">
                <div className="dial-section">
                  <QuickDialGrid
                    title="Clientes"
                    subtitle="Clientes simulados para probar llamadas de venta, soporte y reclamos."
                    entries={clientQuickDial}
                    callingTarget={callingTarget}
                    onCall={(extension, mode) => void originatePanelCall(extension, mode)}
                  />
                  <ManualDialBox
                    title="Marcacion a cliente manual"
                    value={manualDial.client}
                    placeholder="Ej. 9001, 9004, 9005"
                    onChange={(value) => setManualDial((current) => ({ ...current, client: value }))}
                    onSubmit={(event) => void submitManualDial(event, "client")}
                  />
                  <button className="secondary-button full" type="button" onClick={startNewClient}>
                    <Plus size={18} />
                    Nuevo cliente
                  </button>
                  <ExtensionZone
                    title="Directorio clientes"
                    subtitle="Personas registradas en la segunda red privada. Puedes llamarlas o editar sus datos."
                    extensions={clientExtensions}
                    callingTarget={callingTarget}
                    onCall={(extension, mode) => void originatePanelCall(extension, mode)}
                    onEdit={startEditingExtension}
                  />
                </div>
              </Panel>
            </section>

            <Panel
              title="Tiempo real - llamadas"
              icon={
                <span className="live-counter">
                  <Activity size={18} />
                  {activeCalls.length}
                </span>
              }
              id="llamadas"
              className="calls-panel"
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Origen</th>
                      <th>Destino</th>
                      <th>Estado</th>
                      <th>Duracion</th>
                      <th>Fuente</th>
                      <th>Evidencia</th>
                      <th>Inicio</th>
                      <th>Accion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCalls.length === 0 && (
                      <tr>
                        <td className="empty-cell" colSpan={8}>
                          No hay llamadas registradas.
                        </td>
                      </tr>
                    )}
                    {visibleCalls.map((call) => (
                      <tr key={call.id}>
                        <td>
                          <strong>{call.nombre_origen ?? call.extension_origen ?? "N/D"}</strong>
                          <span>{call.extension_origen ?? call.ami_linkedid ?? "sin origen"}</span>
                        </td>
                        <td>
                          <strong>{call.nombre_destino ?? call.extension_destino ?? "N/D"}</strong>
                          <span>{call.extension_destino ?? call.ultimo_evento ?? "sin destino"}</span>
                        </td>
                        <td>
                          <StatusPill value={call.estado} />
                        </td>
                        <td>{formatDuration(call)}</td>
                        <td>
                          <strong>{displaySource(call.fuente)}</strong>
                          <span>{call.ultimo_evento ? displayStatus(call.ultimo_evento) : "sin evento"}</span>
                        </td>
                        <td>
                          <span title={call.evidencia_key ?? undefined}>
                            {call.evidencia_key ? shortKey(call.evidencia_key) : "sin evidencia"}
                          </span>
                        </td>
                        <td>{formatTime(call.fecha_inicio)}</td>
                        <td>
                          {!call.fecha_fin && (
                            <button
                              className="icon-button compact"
                              type="button"
                              onClick={() => void endCall(call.id)}
                              aria-label="Finalizar llamada"
                            >
                              <Square size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="table-footer">
                <span>
                  Mostrando {visibleCalls.length === 0 ? 0 : (page - 1) * tablePageSize + 1} a{" "}
                  {Math.min(page * tablePageSize, llamadas.length)} de {llamadas.length} llamadas
                </span>
                <div className="pager">
                  <button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>
                    &laquo;
                  </button>
                  <button type="button" className="active">
                    {page}
                  </button>
                  <button type="button" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}>
                    &raquo;
                  </button>
                  <span>{tablePageSize} por pagina</span>
                </div>
                <span>Actualizado: {formatTime(observability?.at)}</span>
              </div>
            </Panel>
          </div>

          <aside className="right-column">
            <Panel id="usuarios" title="Directorio - usuarios" icon={<Users size={20} />}>
              <div className="user-list">
                {usuarios.map((user) => {
                  const runtime = extensionStatuses.find((status) => status.extension === user.extension);

                  return (
                    <div className="user-row" key={user.id}>
                      <div className="row-main">
                        <strong>{user.nombre}</strong>
                        <span>{user.area ?? user.procedencia ?? "Sin area"}</span>
                      </div>
                      <code>{user.extension}</code>
                      {runtime?.reachable === false && <AlertTriangle className="warn-icon" size={18} />}
                      <button
                        className="icon-button compact"
                        type="button"
                        onClick={() => startEditingUser(user)}
                        aria-label={`Editar ${user.extension}`}
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Observabilidad - operacion" icon={<BarChart3 size={20} />}>
              <div className="metric-list">
                <MetricRow label="Requests" value={observability?.metrics.requestCount ?? 0} />
                <MetricRow label="Errores API" value={observability?.metrics.errorCount ?? 0} />
                <MetricRow label="Eventos llamada" value={observability?.metrics.callEvents ?? 0} />
                <MetricRow label="Evidencias 24h" value={`${observability?.callStats.recentEvidenceCoveragePercent ?? 0}%`} />
                <MetricRow label="Grabaciones" value={recordings.length} />
                <MetricRow label="Provisionador" value={health?.provisioner.ok ? "OK" : "FALLA"} />
              </div>
            </Panel>

            <Panel title="Seguridad - voz y datos" icon={<Shield size={20} />}>
              <div className="metric-list">
                <MetricRow label="Segmentacion voz" value="SIP/RTP aislado" />
                <MetricRow label="Estado en tiempo real" value={callCenterHealth?.config.stateStore ?? "Redis"} />
                <MetricRow label="Transcripciones" value={callCenterHealth?.config.transcriptStore ?? "MongoDB"} />
                <MetricRow label="PAN tarjetas" value="Enmascarado" />
                <MetricRow label="Original sensible" value="Cifrado" />
                <MetricRow label="Grabaciones" value={callCenterHealth?.config.security.recordingEncryptionMode ?? "aes-256-gcm"} />
              </div>
            </Panel>

            <Panel id="configuracion" title="Red SIP/RTP" icon={<RadioTower size={20} />}>
              <form className="user-form" onSubmit={(event) => void applyTelephonyNetwork(event)}>
                <button className="secondary-button full" type="button" disabled={detectingNetwork} onClick={() => void detectTelephonyNetwork()}>
                  <RefreshCw size={18} />
                  {detectingNetwork ? "Detectando" : "Detectar IP actual"}
                </button>
                <label>
                  IP del servidor
                  <input
                    required
                    inputMode="decimal"
                    pattern="(?:[0-9]{1,3}\.){3}[0-9]{1,3}"
                    placeholder="Ej. 10.252.209.137"
                    value={networkForm.lanIp}
                    onChange={(event) => setNetworkForm((current) => ({ ...current, lanIp: event.target.value }))}
                  />
                </label>
                <label>
                  CIDR de red
                  <input
                    required
                    inputMode="numeric"
                    min="8"
                    max="30"
                    type="number"
                    value={networkForm.lanCidr}
                    onChange={(event) => setNetworkForm((current) => ({ ...current, lanCidr: event.target.value }))}
                  />
                </label>
                <div className="network-summary">
                  <MetricRow label="Red local" value={networkPreview ?? "Completar IP"} />
                  <MetricRow label="SIP" value={`${networkForm.lanIp || "IP"}:5060/UDP`} />
                  <MetricRow label="RTP" value="10000-10100/UDP" />
                </div>
                {networkNotice && <p className="form-success">{networkNotice}</p>}
                {networkError && <p className="form-error">{networkError}</p>}
                <button className="primary-button full" type="submit" disabled={applyingNetwork}>
                  <RadioTower size={18} />
                  {applyingNetwork ? "Aplicando" : "Aplicar red"}
                </button>
              </form>
            </Panel>

            <Panel id="grabaciones" title="Grabaciones - CDR" icon={<FileAudio size={20} />}>
              <div className="recording-list">
                {recordings.length === 0 && <p className="empty-note">Sin grabaciones registradas.</p>}
                {recordings.slice(0, 4).map((recording) => (
                  <div className="recording-row" key={`${recording.uniqueid}-${recording.file}`}>
                    <div className="row-main">
                      <strong>
                        {recording.src} {"->"} {recording.dst}
                      </strong>
                      <span>{recording.file}</span>
                    </div>
                    <button
                      className="icon-button compact"
                      type="button"
                      disabled={!recording.available}
                      onClick={() => void downloadRecording(recording)}
                      aria-label="Descargar grabacion"
                    >
                      <Download size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel id="auditoria" title="Auditoria - acciones" icon={<Shield size={20} />}>
              <div className="audit-list">
                {audit.slice(0, 5).map((item) => (
                  <div className="audit-row" key={item.id}>
                    <StatusPill value={auditTone(item.accion)} />
                    <div className="row-main">
                      <strong>{auditLabel(item.accion)}</strong>
                      <span>
                        {item.actor} - {formatTime(item.creado_en)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel
              id="usuario-form"
              title={editingExtension ? `Editar usuario ${editingExtension}` : "Alta rapida - registrar"}
              icon={<PhoneCall size={20} />}
            >
              <form className="user-form" onSubmit={(event) => void submitUser(event)}>
                <label>
                  Nombre
                  <input
                    required
                    placeholder="Nombre del usuario"
                    value={form.nombre}
                    onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value }))}
                  />
                </label>
                <label>
                  Extension
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]{2,10}"
                    placeholder="Ej. 1003"
                    value={form.extension}
                    disabled={Boolean(editingExtension)}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        extension: event.target.value,
                        sipSecret:
                          current.sipSecret === "" || current.sipSecret === `Telefonia${current.extension}`
                            ? `Telefonia${event.target.value}`
                            : current.sipSecret
                      }))
                    }
                  />
                </label>
                {!editingExtension && (
                  <label>
                    Clave SIP
                    <input
                      required={form.provisionFreepbx}
                      placeholder="Telefonia1003"
                      value={form.sipSecret}
                      onChange={(event) => setForm((current) => ({ ...current, sipSecret: event.target.value }))}
                    />
                  </label>
                )}
                <label>
                  Procedencia
                  <input
                    placeholder="Ej. Soporte"
                    value={form.procedencia}
                    onChange={(event) => setForm((current) => ({ ...current, procedencia: event.target.value }))}
                  />
                </label>
                <label>
                  Area
                  <input
                    placeholder="Ej. Soporte Tecnico"
                    value={form.area}
                    onChange={(event) => setForm((current) => ({ ...current, area: event.target.value }))}
                  />
                </label>
                {!editingExtension && (
                  <div className="switch-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={form.provisionFreepbx}
                        onChange={(event) => setForm((current) => ({ ...current, provisionFreepbx: event.target.checked }))}
                      />
                      Crear extension en FreePBX
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={form.recordCalls}
                        onChange={(event) => setForm((current) => ({ ...current, recordCalls: event.target.checked }))}
                      />
                      Grabar llamadas
                    </label>
                  </div>
                )}
                {formNotice && <p className="form-success">{formNotice}</p>}
                {formError && <p className="form-error">{formError}</p>}
                {editingExtension && (
                  <button className="secondary-button full" type="button" onClick={cancelEditingUser}>
                    <X size={18} />
                    Cancelar edicion
                  </button>
                )}
                <button className="primary-button full" type="submit" disabled={saving}>
                  {editingExtension ? <Pencil size={18} /> : <Plus size={18} />}
                  {editingExtension ? "Guardar cambios" : "Registrar"}
                </button>
              </form>
            </Panel>
          </aside>
        </section>
      </section>
      <audio ref={remoteAudioRef} autoPlay playsInline />
    </main>
  );
}

function SidebarItem({
  active = false,
  icon,
  label,
  onClick
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`side-link ${active ? "active" : ""}`} type="button" onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function Panel({
  id,
  title,
  icon,
  className = "",
  children
}: {
  id?: string;
  title: string;
  icon: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`panel ${className}`}>
      <div className="panel-header">
        <h2>{title}</h2>
        {icon}
      </div>
      {children}
    </section>
  );
}

function ProviderIcon({ supplier }: { supplier: DemoSupplier }) {
  if (supplier === "postgres") {
    return <Database className="provider-icon" size={27} />;
  }

  if (supplier === "ami") {
    return <RadioTower className="provider-icon orange" size={27} />;
  }

  if (supplier === "floci-sqs") {
    return <Cloud className="provider-icon green" size={27} />;
  }

  if (supplier === "dialer") {
    return <PhoneCall className="provider-icon orange" size={27} />;
  }

  if (supplier === "transcription") {
    return <FileAudio className="provider-icon green" size={27} />;
  }

  if (supplier === "metrics") {
    return <BarChart3 className="provider-icon dark" size={27} />;
  }

  return <FileText className="provider-icon dark" size={27} />;
}

function WebphonePanel({
  config,
  status,
  registered,
  inCall,
  incoming,
  canAnswer,
  busy,
  notice,
  error,
  mode,
  localVideoRef,
  remoteVideoRef,
  onChange,
  onConnect,
  onDisconnect,
  onAnswer,
  onAnswerVideo,
  onHangup
}: {
  config: WebphoneConfig;
  status: string;
  registered: boolean;
  inCall: boolean;
  incoming: boolean;
  canAnswer: boolean;
  busy: boolean;
  notice: string | null;
  error: string | null;
  mode: WebphoneCallMode;
  localVideoRef: RefObject<HTMLVideoElement | null>;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  onChange: (value: SetStateAction<WebphoneConfig>) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onAnswer: () => void;
  onAnswerVideo: () => void;
  onHangup: () => void;
}) {
  return (
    <div className="webphone-card">
      <div className="zone-heading">
        <strong>Telefono web del navegador</strong>
        <span>Extension {config.extension}. Permite llamar desde esta laptop sin abrir Linphone.</span>
      </div>
      <div className="webphone-grid">
        <label>
          Extension
          <input value={config.extension} onChange={(event) => onChange((current) => ({ ...current, extension: event.target.value }))} />
        </label>
        <label>
          Clave SIP
          <input
            type="password"
            value={config.password}
            onChange={(event) => onChange((current) => ({ ...current, password: event.target.value }))}
          />
        </label>
        <label>
          WS SIP
          <input value={config.server} onChange={(event) => onChange((current) => ({ ...current, server: event.target.value }))} />
        </label>
        <label>
          Dominio SIP
          <input value={config.aorHost} onChange={(event) => onChange((current) => ({ ...current, aorHost: event.target.value }))} />
        </label>
      </div>
      <div className="webphone-actions">
        <StatusPill value={status} />
        <button className="primary-button compact-action" type="button" disabled={busy || registered} onClick={onConnect}>
          <Wifi size={16} />
          Conectar
        </button>
        <button className="secondary-button compact-action" type="button" disabled={busy || !registered} onClick={onDisconnect}>
          <WifiOff size={16} />
          Desconectar
        </button>
        <button className="secondary-button compact-action" type="button" disabled={busy || !incoming || !canAnswer} onClick={onAnswer}>
          <PhoneCall size={16} />
          Resp. audio
        </button>
        <button className="secondary-button compact-action" type="button" disabled={busy || !incoming || !canAnswer} onClick={onAnswerVideo}>
          <Video size={16} />
          Resp. video
        </button>
        <button className="secondary-button compact-action" type="button" disabled={busy || (!inCall && !incoming)} onClick={onHangup}>
          <Square size={16} />
          Colgar
        </button>
      </div>
      <div className="webphone-preview-grid">
        <div className="webphone-preview">
          <strong>Camara local</strong>
          <video ref={localVideoRef} autoPlay playsInline muted />
        </div>
        <div className="webphone-preview">
          <strong>Video remoto</strong>
          <video ref={remoteVideoRef} autoPlay playsInline />
        </div>
      </div>
      <div className="webphone-hint">
        <span>{registered ? "Listo para marcar usando 1099" : "Conecta primero el telefono web para usar 1099 como origen"}</span>
        <span>Modo actual: {mode === "video" ? "videollamada" : "audio"}.</span>
      </div>
      {(notice || error) && (
        <div className="callcenter-message">
          {notice && <p className="form-success">{notice}</p>}
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

function buildDefaultWebphoneConfig(): WebphoneConfig {
  const host = window.location.hostname || "localhost";

  return normalizeWebphoneConfig({
    extension: "1099",
    password: "Telefonia1099",
    server: buildSipWebSocketUrl(),
    aorHost: host
  });
}

function normalizeWebphoneConfig(config: WebphoneConfig): WebphoneConfig {
  const host = window.location.hostname || config.aorHost || "localhost";

  return {
    ...config,
    server: buildSipWebSocketUrl(),
    aorHost: config.aorHost || host
  };
}

function buildSipWebSocketUrl() {
  const apiUrl = new URL(API_URL);
  apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
  apiUrl.pathname = "/sip-ws";
  apiUrl.search = "";
  apiUrl.hash = "";
  return apiUrl.toString();
}

function QuickDialGrid({
  title,
  subtitle,
  entries,
  callingTarget,
  onCall
}: {
  title: string;
  subtitle: string;
  entries: ExtensionRuntimeStatus[];
  callingTarget: string | null;
  onCall: (extension: string, mode: "audio" | "video") => void;
}) {
  return (
    <div className="quick-dial-block">
      <div className="zone-heading">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="quick-dial-grid">
        {entries.map((entry) => (
          <div className="quick-dial-card" key={entry.extension}>
            <div className="row-main">
              <strong>{entry.area ?? entry.nombre ?? "Extension"}</strong>
              <span>
                {entry.nombre ?? "Usuario"} - {entry.extension}
              </span>
            </div>
            <div className="quick-actions">
              <button
                className="primary-button compact-action"
                type="button"
                disabled={callingTarget === `audio:${entry.extension}`}
                onClick={() => onCall(entry.extension, "audio")}
              >
                <Phone size={16} />
                Llamar
              </button>
              <button
                className="secondary-button compact-action"
                type="button"
                disabled={callingTarget === `video:${entry.extension}`}
                onClick={() => onCall(entry.extension, "video")}
              >
                <Video size={16} />
                Video
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManualDialBox({
  title,
  value,
  placeholder,
  onChange,
  onSubmit
}: {
  title: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="manual-dial-box" onSubmit={onSubmit}>
      <label>
        {title}
        <input
          required
          inputMode="numeric"
          pattern="[0-9]{2,10}"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button className="primary-button compact-action" type="submit">
        <PhoneCall size={16} />
        Marcar
      </button>
    </form>
  );
}

function ExtensionZone({
  title,
  subtitle,
  extensions,
  callingTarget,
  onCall,
  onEdit
}: {
  title: string;
  subtitle: string;
  extensions: ExtensionRuntimeStatus[];
  callingTarget: string | null;
  onCall: (extension: string, mode: "audio" | "video") => void;
  onEdit?: (extension: string) => void;
}) {
  return (
    <div className="extension-zone">
      <div className="zone-heading">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {extensions.length === 0 && <p className="empty-note">Sin extensiones registradas en esta zona.</p>}
      {extensions.map((extension) => (
        <div className="extension-row" key={extension.extension}>
          {extension.reachable === false ? <WifiOff size={17} /> : <Wifi size={17} />}
          <code>{extension.extension}</code>
          <div className="row-main">
            <strong>{extension.nombre ?? "Extension"}</strong>
            <span>{extension.area ?? extension.technology}</span>
          </div>
          <StatusPill value={extension.reachable === false ? "NO DISPONIBLE" : extension.status} />
          <div className="extension-actions">
            {onEdit && (
              <button
                className="icon-button compact"
                type="button"
                onClick={() => onEdit(extension.extension)}
                aria-label={`Editar ${extension.extension}`}
              >
                <Pencil size={14} />
              </button>
            )}
            <button
              className="icon-button compact"
              type="button"
              disabled={callingTarget === `audio:${extension.extension}`}
              onClick={() => onCall(extension.extension, "audio")}
              aria-label={`Llamar a ${extension.extension}`}
            >
              <Phone size={14} />
            </button>
            <button
              className="icon-button compact"
              type="button"
              disabled={callingTarget === `video:${extension.extension}`}
              onClick={() => onCall(extension.extension, "video")}
              aria-label={`Video llamada a ${extension.extension}`}
            >
              <Video size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusTile({
  icon,
  title,
  state,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue
}: {
  icon: ReactNode;
  title: string;
  state: string | undefined;
  leftLabel: string;
  leftValue: string | number;
  rightLabel: string;
  rightValue: string | number;
}) {
  return (
    <div className="status-tile">
      <div className="tile-main">
        <div className="status-icon">{icon}</div>
        <div>
          <strong>{title}</strong>
          <span className={statusClass(state)}>{state ?? "..."}</span>
        </div>
      </div>
      <div className="tile-meta">
        <span>
          {leftLabel}
          <strong>{leftValue}</strong>
        </span>
        <span>
          {rightLabel}
          <strong>{rightValue}</strong>
        </span>
      </div>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  return <span className={`pill ${statusClass(value)}`}>{displayStatus(value)}</span>;
}

function displayStatus(value: string | null | undefined) {
  if (!value) {
    return "Sin dato";
  }

  const labels: Record<string, string> = {
    ANSWERED: "Contestada",
    BRIDGEENTER: "Conectada",
    BUSY: "Ocupado",
    CANCEL: "Cancelada",
    CHANUNAVAIL: "Canal no disponible",
    CLOSED: "Cerrado",
    COMPLETED: "Completada",
    CONGESTION: "Congestion",
    CONNECTED: "Conectado",
    DIALBEGIN: "Marcando",
    DIALEND: "Marcacion finalizada",
    DIALING: "Marcando",
    DISCONNECTED: "Desconectado",
    FAILED: "Fallida",
    HANGUP: "Finalizada",
    HALF_OPEN: "Medio abierto",
    INUSE: "En uso",
    NEWCHANNEL: "Canal creado",
    NOANSWER: "No contestada",
    NOT_INUSE: "Libre",
    OPEN: "Abierto",
    ORIGINATE_FAILED: "Originate fallido",
    PENDING: "Pendiente",
    REACHABLE: "Disponible",
    REGISTERED: "Registrado",
    RINGING: "Timbrando",
    UNAVAILABLE: "No disponible",
    UNREACHABLE: "No alcanzable",
    UNREGISTERED: "No registrado",
    UNKNOWN: "Desconocido"
  };

  return labels[value.toUpperCase()] ?? value;
}

function displaySource(value: string | null | undefined) {
  const labels: Record<string, string> = {
    ami: "Asterisk AMI",
    manual: "Manual",
    simulator: "Simulador",
    cdr: "Asterisk CDR"
  };

  return labels[(value ?? "").toLowerCase()] ?? value ?? "Sin fuente";
}

function isIncomingCallForExtension(call: Llamada, extension: string) {
  const target = extension.trim();

  if (!target || call.extension_origen === target) {
    return false;
  }

  const state = call.estado.toUpperCase();
  const event = call.ultimo_evento?.toUpperCase() ?? "";
  const destinationName = call.nombre_destino?.toLowerCase() ?? "";

  if (!["RINGING", "NEWCHANNEL"].includes(state) && !["DIALBEGIN", "NEWCHANNEL"].includes(event)) {
    return false;
  }

  return call.extension_destino === target || destinationName.includes(target) || destinationName.includes("operador web");
}

function isCallForExtension(call: Llamada, extension: string) {
  const target = extension.trim();

  if (!target) {
    return false;
  }

  const originName = call.nombre_origen?.toLowerCase() ?? "";
  const destinationName = call.nombre_destino?.toLowerCase() ?? "";

  return (
    call.extension_origen === target ||
    call.extension_destino === target ||
    originName.includes(target) ||
    destinationName.includes(target) ||
    originName.includes("operador web") ||
    destinationName.includes("operador web")
  );
}

function hasTerminalSibling(call: Llamada, calls: Llamada[]) {
  const identifiers = new Set([call.ami_linkedid, call.ami_uniqueid].filter(Boolean));

  if (identifiers.size === 0) {
    return false;
  }

  return calls.some((candidate) => {
    if (candidate.id === call.id || !isTerminalCall(candidate)) {
      return false;
    }

    return (
      (candidate.ami_linkedid !== null && identifiers.has(candidate.ami_linkedid)) ||
      (candidate.ami_uniqueid !== null && identifiers.has(candidate.ami_uniqueid))
    );
  });
}

function isTerminalCall(call: Llamada) {
  return Boolean(call.fecha_fin) || ["BUSY", "CANCEL", "CHANUNAVAIL", "COMPLETED", "CONGESTION", "FAILED", "HANGUP", "NOANSWER"].includes(call.estado);
}

function statusClass(value: string | undefined) {
  if (!value) {
    return "muted";
  }

  const normalized = value.toUpperCase();

  if (
    [
      "OK",
      "CONNECTED",
      "CONECTADO",
      "ANSWERED",
      "COMPLETED",
      "CLOSED",
      "REACHABLE",
      "REGISTERED",
      "NOT_INUSE",
      "INUSE",
      "INFO",
      "DISPONIBLE",
      "OPORTUNIDAD",
      "ENMASCARADO"
    ].includes(normalized)
  ) {
    return "good";
  }

  if (
    [
      "OFF",
      "CONNECTING",
      "RINGING",
      "HALF_OPEN",
      "NEWCHANNEL",
      "UNKNOWN",
      "WARN",
      "SIN DATOS",
      "PENDING",
      "DIALING",
      "SIN OPORTUNIDAD"
    ].includes(normalized)
  ) {
    return "warn";
  }

  if (
    [
      "FALLA",
      "ERROR",
      "DISCONNECTED",
      "OPEN",
      "HANGUP",
      "BUSY",
      "NOANSWER",
      "UNAVAILABLE",
      "UNREACHABLE",
      "UNREGISTERED",
      "NO DISPONIBLE",
      "FAILED",
      "ORIGINATE_FAILED",
      "DEGRADADO",
      "INCUMPLE"
    ].includes(normalized)
  ) {
    return "bad";
  }

  return "muted";
}

function upsertById<T extends { id: number }>(items: T[], item: T): T[] {
  const exists = items.some((current) => current.id === item.id);
  const next = exists ? items.map((current) => (current.id === item.id ? item : current)) : [item, ...items];
  return next.slice(0, 80);
}

function byExtension(a: Usuario, b: Usuario) {
  return a.extension.localeCompare(b.extension);
}

function isSimulatedClientExtension(extension: string) {
  const value = Number(extension);
  return Number.isInteger(value) && value >= 9000 && value <= 9999;
}

function buildCompanyQuickDial(extensions: ExtensionRuntimeStatus[]) {
  const preferred = ["Soporte", "Marketing", "Ventas", "Supervisores", "Agentes"];

  return [...extensions].sort((a, b) => {
    const areaA = a.area ?? "";
    const areaB = b.area ?? "";
    const indexA = preferred.findIndex((area) => areaA.toLowerCase().includes(area.toLowerCase()));
    const indexB = preferred.findIndex((area) => areaB.toLowerCase().includes(area.toLowerCase()));

    if (indexA !== indexB) {
      return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
    }

    return a.extension.localeCompare(b.extension);
  });
}

function previewNetwork(ip: string, cidr: number) {
  const parts = ip.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255) || cidr < 8 || cidr > 30) {
    return null;
  }

  const mask = (0xffffffff << (32 - cidr)) >>> 0;
  const address = parts.reduce((acc, part) => ((acc << 8) + part) >>> 0, 0);
  const network = (address & mask) >>> 0;
  const networkIp = [24, 16, 8, 0].map((shift) => (network >>> shift) & 255).join(".");

  return `${networkIp}/${cidr}`;
}

function isUsableIpv4(value: string) {
  const parts = value.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return !value.startsWith("127.") && !value.startsWith("169.254.") && value !== "0.0.0.0";
}

function suggestCidr(ip: string) {
  if (ip.startsWith("10.")) {
    return 16;
  }

  return 24;
}

function formatTime(value: string | null | undefined) {
  if (!value) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatDuration(call: Llamada) {
  if (call.duracion_segundos !== null) {
    return `${call.duracion_segundos}s`;
  }

  if (["BUSY", "CANCEL", "CHANUNAVAIL", "COMPLETED", "CONGESTION", "FAILED", "HANGUP", "NOANSWER"].includes(call.estado)) {
    return "finalizada";
  }

  if (!call.fecha_fin) {
    return "en curso";
  }

  return "N/D";
}

function shortKey(value: string) {
  const parts = value.split("/");
  return parts.slice(-2).join("/");
}

function auditTone(action: string) {
  if (action.includes("failed") || action.includes("failure.enabled")) {
    return "WARN";
  }

  if (action.includes("created") || action.includes("login")) {
    return "INFO";
  }

  return "OK";
}

function auditLabel(action: string) {
  const labels: Record<string, string> = {
    "auth.login": "Inicio de sesion",
    "auth.failed": "Login fallido",
    "user.created": "Usuario creado",
    "call.closed.manual": "Llamada cerrada",
    "call.simulated": "Llamada simulada",
    "supplier.failure.enabled": "Falla activada",
    "supplier.failure.disabled": "Falla recuperada"
  };

  return labels[action] ?? action;
}
