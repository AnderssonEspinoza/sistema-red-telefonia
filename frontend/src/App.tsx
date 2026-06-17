import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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
  Wifi,
  WifiOff
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:3000";

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

interface LoginForm {
  username: string;
  password: string;
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
const activeCallMaxAgeMs = 8 * 60 * 60 * 1000;
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
  const [saving, setSaving] = useState(false);
  const [dialingLead, setDialingLead] = useState(false);
  const [analyzingText, setAnalyzingText] = useState(false);
  const [callCenterNotice, setCallCenterNotice] = useState<string | null>(null);
  const [callCenterError, setCallCenterError] = useState<string | null>(null);
  const [togglingSupplier, setTogglingSupplier] = useState<DemoSupplier | null>(null);
  const [page, setPage] = useState(1);
  const [activeNav, setActiveNav] = useState("resumen");

  const activeCalls = useMemo(
    () =>
      llamadas.filter(
        (call) =>
          !call.fecha_fin &&
          Date.now() - new Date(call.fecha_inicio).getTime() < activeCallMaxAgeMs &&
          ["RINGING", "ANSWERED", "NEWCHANNEL"].includes(call.estado)
      ),
    [llamadas]
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
      };
    };

    connect();

    return () => {
      closed = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [authConfigState?.enabled, isAuthorized, token]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  async function submitUser(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormNotice(null);
    setFormError(null);

    try {
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

  const callCenterMetrics = callCenter?.metrics;
  const leads = callCenter?.leads.leads ?? [];
  const nextLead = callCenter?.leads.nextLead ?? null;
  const transcripts = callCenter?.transcripts.transcripts ?? [];
  const callCenterHealth = callCenter?.health ?? health?.callCenter ?? observability?.callCenter ?? null;
  const callCenterState = callCenterHealth ? (callCenterHealth.ok ? "OK" : "FALLA") : undefined;

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
      icon: <PhoneCall size={25} />,
      title: "Call Center IA",
      state: callCenterState,
      leftLabel: "Leads pendientes",
      leftValue: callCenterMetrics?.leadsPending ?? callCenter?.leads.pending ?? 0,
      rightLabel: "Oportunidades",
      rightValue: callCenterMetrics?.salesOpportunities ?? 0
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
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="app-frame">
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
          <SidebarItem active={activeNav === "callcenter"} icon={<PhoneCall size={20} />} label="Call Center" onClick={() => navigateToSection("callcenter")} />
          <SidebarItem active={activeNav === "llamadas"} icon={<PhoneCall size={20} />} label="Llamadas" onClick={() => navigateToSection("llamadas")} />
          <SidebarItem active={activeNav === "extensiones"} icon={<SlidersHorizontal size={20} />} label="Extensiones" onClick={() => navigateToSection("extensiones")} />
          <SidebarItem active={activeNav === "proveedores"} icon={<Settings size={20} />} label="Proveedores" onClick={() => navigateToSection("proveedores")} />
          <SidebarItem active={activeNav === "usuarios"} icon={<Users size={20} />} label="Usuarios" onClick={() => navigateToSection("usuarios")} />
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
            <button className="primary-button" type="button" disabled={dialingLead} onClick={() => void dialNextLeadAction()}>
              <Play size={18} />
              Marcar lead
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

              <Panel id="extensiones" title="Softphones - extensiones" icon={<Headphones size={20} />} className="softphone-panel">
                <div className="extension-list">
                  {extensionStatuses.map((extension) => (
                    <div className="extension-row" key={extension.extension}>
                      {extension.reachable === false ? <WifiOff size={17} /> : <Wifi size={17} />}
                      <code>{extension.extension}</code>
                      <div className="row-main">
                        <strong>{extension.nombre ?? "Extension"}</strong>
                        <span>{extension.area ?? extension.technology}</span>
                      </div>
                      <StatusPill value={extension.reachable === false ? "NO DISPONIBLE" : extension.status} />
                    </div>
                  ))}
                </div>
              </Panel>
            </section>

            <Panel id="callcenter" title="Call center - ventas y calidad" icon={<PhoneCall size={20} />} className="callcenter-panel">
              <div className="callcenter-overview">
                <div className="callcenter-kpis">
                  <MetricCard label="Leads pendientes" value={callCenterMetrics?.leadsPending ?? callCenter?.leads.pending ?? 0} />
                  <MetricCard label="Marcaciones" value={callCenterMetrics?.callsTotal ?? 0} />
                  <MetricCard label="Contestadas" value={`${callCenterMetrics?.answerRatePercent ?? 0}%`} />
                  <MetricCard label="Oportunidades" value={callCenterMetrics?.salesOpportunities ?? 0} />
                  <MetricCard label="Calidad promedio" value={`${callCenterMetrics?.averageQualityScore ?? 0}/100`} />
                  <MetricCard label="Datos enmascarados" value={callCenterMetrics?.sensitiveMasked ?? 0} />
                </div>
                <div className="callcenter-actions">
                  <div className="next-lead-box">
                    <span>Siguiente lead</span>
                    <strong>{nextLead ? `${nextLead.name} (${nextLead.phone})` : "Sin leads pendientes"}</strong>
                  </div>
                  <button className="primary-button full" type="button" disabled={dialingLead} onClick={() => void dialNextLeadAction()}>
                    <Play size={18} />
                    {dialingLead ? "Marcando" : "Marcar siguiente lead"}
                  </button>
                  <button className="secondary-button full" type="button" disabled={analyzingText} onClick={() => void analyzeDemoText()}>
                    <FileText size={18} />
                    {analyzingText ? "Analizando" : "Analizar texto demo"}
                  </button>
                  <button className="secondary-button full" type="button" onClick={() => void simulateCall()}>
                    <Activity size={18} />
                    Registrar llamada demo
                  </button>
                </div>
              </div>

              {(callCenterNotice || callCenterError) && (
                <div className="callcenter-message">
                  {callCenterNotice && <p className="form-success">{callCenterNotice}</p>}
                  {callCenterError && <p className="form-error">{callCenterError}</p>}
                </div>
              )}

              <div className="callcenter-detail-grid">
                <div className="lead-list">
                  <h3>Cola de leads</h3>
                  {leads.length === 0 && <p className="empty-note">Sin leads cargados.</p>}
                  {leads.slice(0, 4).map((lead) => (
                    <div className="lead-row" key={lead.id}>
                      <div className="row-main">
                        <strong>{lead.name}</strong>
                        <span>
                          {lead.phone} - prioridad {lead.priority}
                        </span>
                      </div>
                      <StatusPill value={lead.status} />
                    </div>
                  ))}
                </div>
                <div className="transcript-list">
                  <h3>Analisis de llamadas</h3>
                  {transcripts.length === 0 && <p className="empty-note">Sin transcripciones registradas.</p>}
                  {transcripts.slice(0, 3).map((transcript) => (
                    <div className="transcript-row" key={transcript._id}>
                      <div className="row-main">
                        <strong>{transcript.leadName ?? transcript.callId}</strong>
                        <span>{transcript.analysis.summary}</span>
                      </div>
                      <div className="transcript-tags">
                        <StatusPill value={transcript.analysis.opportunity ? "OPORTUNIDAD" : "SIN OPORTUNIDAD"} />
                        {transcript.sensitiveDataMasked && <StatusPill value="ENMASCARADO" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>

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
                          <strong>{call.fuente}</strong>
                          <span>{call.ultimo_evento ?? "sin evento"}</span>
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

            <Panel title="Alta rapida - registrar" icon={<PhoneCall size={20} />}>
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
                <label>
                  Clave SIP
                  <input
                    required={form.provisionFreepbx}
                    placeholder="Telefonia1003"
                    value={form.sipSecret}
                    onChange={(event) => setForm((current) => ({ ...current, sipSecret: event.target.value }))}
                  />
                </label>
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
                {formNotice && <p className="form-success">{formNotice}</p>}
                {formError && <p className="form-error">{formError}</p>}
                <button className="primary-button full" type="submit" disabled={saving}>
                  <Plus size={18} />
                  Registrar
                </button>
              </form>
            </Panel>
          </aside>
        </section>
      </section>
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
  return <span className={`pill ${statusClass(value)}`}>{value}</span>;
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
