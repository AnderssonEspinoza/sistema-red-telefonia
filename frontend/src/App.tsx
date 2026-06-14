import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Cloud,
  Cpu,
  Database,
  Download,
  FileText,
  Headphones,
  LogIn,
  LogOut,
  PhoneCall,
  Play,
  Plus,
  Power,
  PowerOff,
  RadioTower,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  Square,
  Users,
  Wifi,
  WifiOff
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:3000";

type DemoSupplier = "postgres" | "ami" | "floci-sqs" | "floci-s3";

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
  auth: AuthConfig;
  extensions: ExtensionRuntimeStatus[];
  demoFailures: DemoFailure[];
  suppliers: SupplierStatus[];
  at: string;
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
  events: Array<{
    id: number;
    at: string;
    level: string;
    type: string;
    message: string;
  }>;
}

interface UsuarioForm {
  nombre: string;
  extension: string;
  procedencia: string;
  area: string;
}

interface LoginForm {
  username: string;
  password: string;
}

const emptyForm: UsuarioForm = {
  nombre: "",
  extension: "",
  procedencia: "",
  area: ""
};
const activeCallMaxAgeMs = 8 * 60 * 60 * 1000;
const tokenStorageKey = "telefonia_auth_token";

export function App() {
  const [authConfigState, setAuthConfigState] = useState<AuthConfig | null>(null);
  const [token, setToken] = useState(() => window.localStorage.getItem(tokenStorageKey));
  const [loginForm, setLoginForm] = useState<LoginForm>({ username: "admin", password: "" });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [llamadas, setLlamadas] = useState<Llamada[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [observability, setObservability] = useState<Observability | null>(null);
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionRuntimeStatus[]>([]);
  const [socketState, setSocketState] = useState("CONNECTING");
  const [form, setForm] = useState<UsuarioForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [togglingSupplier, setTogglingSupplier] = useState<DemoSupplier | null>(null);

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

    const [usersResponse, callsResponse, healthResponse, extensionsResponse, observabilityResponse] = await Promise.all([
      apiFetch("/api/users"),
      apiFetch("/api/calls?limit=40"),
      apiFetch("/api/health"),
      apiFetch("/api/extensions/status"),
      apiFetch("/api/observability")
    ]);

    setUsuarios(await usersResponse.json());
    setLlamadas(await callsResponse.json());
    setHealth(await healthResponse.json());
    setExtensionStatuses(await extensionsResponse.json());
    setObservability(await observabilityResponse.json());
  }, [apiFetch, isAuthorized]);

  useEffect(() => {
    if (!isAuthorized) {
      return undefined;
    }

    void loadData();
    const interval = window.setInterval(() => {
      void Promise.all([apiFetch("/api/health"), apiFetch("/api/extensions/status"), apiFetch("/api/observability")])
        .then(async ([healthResponse, extensionsResponse, observabilityResponse]) => {
          setHealth(await healthResponse.json());
          setExtensionStatuses(await extensionsResponse.json());
          setObservability(await observabilityResponse.json());
        })
        .catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [apiFetch, isAuthorized, loadData]);

  useEffect(() => {
    if (!isAuthorized) {
      return undefined;
    }

    let closed = false;
    let retry: number | undefined;
    let socket: WebSocket;

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
      socket.close();
    };
  }, [authConfigState?.enabled, isAuthorized, token]);

  async function submitUser(event: FormEvent) {
    event.preventDefault();
    setSaving(true);

    try {
      const response = await apiFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre,
          extension: form.extension,
          procedencia: form.procedencia || null,
          area: form.area || null
        })
      });

      if (!response.ok) {
        throw new Error("No se pudo registrar");
      }

      setForm(emptyForm);
      await loadData();
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
  }

  async function endCall(id: number) {
    await apiFetch(`/api/calls/${id}/end`, { method: "POST" });
  }

  async function toggleFailure(supplier: DemoSupplier, enabled: boolean) {
    setTogglingSupplier(supplier);

    try {
      const response = await apiFetch(`/api/demo/failures/${supplier}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });

      setHealth(await response.json());
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

    await loadData();
  }

  function logout() {
    window.localStorage.removeItem(tokenStorageKey);
    setToken(null);
    setUsuarios([]);
    setLlamadas([]);
    setHealth(null);
    setObservability(null);
    setExtensionStatuses([]);
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

  if (!authConfigState) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <Shield size={26} />
          <h1>Sistema de Telefonia</h1>
          <p>Inicializando seguridad...</p>
        </section>
      </main>
    );
  }

  if (authConfigState.enabled && !token) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={(event) => void submitLogin(event)}>
          <Shield size={28} />
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
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PBX local con resiliencia</p>
          <h1>Sistema de Telefonia</h1>
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" type="button" onClick={() => void downloadReport()}>
            <Download size={18} />
            Reporte
          </button>
          <button className="icon-button" type="button" onClick={() => void loadData()} aria-label="Actualizar">
            <RefreshCw size={18} />
          </button>
          <button className="primary-button" type="button" onClick={() => void simulateCall()}>
            <Play size={18} />
            Simular llamada
          </button>
          {authConfigState.enabled && (
            <button className="icon-button" type="button" onClick={logout} aria-label="Cerrar sesion">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>

      <section className="status-grid" aria-label="Estado de servicios">
        <StatusTile icon={<Database size={20} />} label="PostgreSQL" state={health?.db.ok ? "OK" : "FALLA"} />
        <StatusTile
          icon={<RadioTower size={20} />}
          label="Asterisk AMI"
          state={!health?.ami.enabled ? "OFF" : health.ami.connected ? "OK" : "FALLA"}
        />
        <StatusTile icon={<Cloud size={20} />} label="Floci SQS" state={health?.floci.sqs.ok ? "OK" : "FALLA"} />
        <StatusTile icon={<FileText size={20} />} label="Floci S3" state={health?.floci.s3.ok ? "OK" : "FALLA"} />
        <StatusTile icon={<BarChart3 size={20} />} label="Asterisk CDR" state={health?.cdr.ok ? "OK" : "FALLA"} />
        <StatusTile icon={<Server size={20} />} label="WebSocket" state={socketState} />
      </section>

      <section className="ops-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Circuit breaker</p>
              <h2>Proveedores</h2>
            </div>
            <Cpu size={20} />
          </div>
          <div className="circuit-list">
            {(health?.suppliers ?? []).map((supplier) => (
              <div className="circuit-row" key={supplier.supplier}>
                <div className="circuit-main">
                  <strong>{supplier.label}</strong>
                  <span>{supplier.role}</span>
                </div>
                <StatusPill value={supplier.circuit.state} />
                <span className="circuit-count">
                  {supplier.circuit.failures}/{supplier.circuit.failureThreshold}
                </span>
                <button
                  className={`toggle-button ${supplier.demoFailure ? "danger" : ""}`}
                  type="button"
                  disabled={togglingSupplier === supplier.supplier}
                  onClick={() => void toggleFailure(supplier.supplier, !supplier.demoFailure)}
                >
                  {supplier.demoFailure ? <Power size={16} /> : <PowerOff size={16} />}
                  {supplier.demoFailure ? "Recuperar" : "Fallar"}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Softphones</p>
              <h2>Extensiones</h2>
            </div>
            <Headphones size={20} />
          </div>
          <div className="extension-list">
            {extensionStatuses.map((extension) => (
              <div className="extension-row" key={extension.extension}>
                <div className="extension-code">
                  {extension.reachable === false ? <WifiOff size={16} /> : <Wifi size={16} />}
                  <code>{extension.extension}</code>
                </div>
                <div className="extension-main">
                  <strong>{extension.nombre ?? "Extension"}</strong>
                  <span>{extension.area ?? extension.technology}</span>
                </div>
                <StatusPill value={extension.status} />
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="layout-grid">
        <div className="panel calls-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Tiempo real</p>
              <h2>Llamadas</h2>
            </div>
            <div className="counter">
              <Activity size={16} />
              {activeCalls.length}
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Origen</th>
                  <th>Destino</th>
                  <th>Estado</th>
                  <th>Duracion</th>
                  <th>Fuente</th>
                  <th>Inicio</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {llamadas.length === 0 && (
                  <tr>
                    <td className="empty-cell" colSpan={7}>
                      No hay llamadas registradas.
                    </td>
                  </tr>
                )}
                {llamadas.map((call) => (
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
                      <span title={call.evidencia_key ?? undefined}>{call.evidencia_key ? shortKey(call.evidencia_key) : "sin evidencia"}</span>
                    </td>
                    <td>{formatTime(call.fecha_inicio)}</td>
                    <td>
                      {!call.fecha_fin && (
                        <button className="icon-button compact" type="button" onClick={() => void endCall(call.id)} aria-label="Finalizar llamada">
                          <Square size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="side-stack">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Directorio</p>
                <h2>Usuarios</h2>
              </div>
              <Users size={20} />
            </div>

            <div className="user-list">
              {usuarios.map((user) => {
                const runtime = extensionStatuses.find((status) => status.extension === user.extension);

                return (
                  <div className="user-row" key={user.id}>
                    <div>
                      <strong>{user.nombre}</strong>
                      <span>{user.area ?? "Sin area"}</span>
                    </div>
                    <div className="user-extension">
                      <code>{user.extension}</code>
                      {runtime?.reachable === true && <ShieldCheck className="good-icon" size={14} />}
                      {runtime?.reachable === false && <AlertTriangle className="warn-icon" size={14} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Observabilidad</p>
                <h2>Operacion</h2>
              </div>
              <BarChart3 size={20} />
            </div>
            <div className="metric-list">
              <MetricRow label="Requests" value={observability?.metrics.requestCount ?? 0} />
              <MetricRow label="Errores API" value={observability?.metrics.errorCount ?? 0} />
              <MetricRow label="Eventos llamada" value={observability?.metrics.callEvents ?? 0} />
              <MetricRow label="Evidencias 24h" value={`${observability?.callStats.recentEvidenceCoveragePercent ?? 0}%`} />
            </div>
            <div className="event-list">
              {(observability?.events ?? []).slice(0, 3).map((event) => (
                <div className="event-row" key={event.id}>
                  <StatusPill value={event.level} />
                  <span>{event.message}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Alta rapida</p>
                <h2>Registrar</h2>
              </div>
              <PhoneCall size={20} />
            </div>

            <form className="user-form" onSubmit={(event) => void submitUser(event)}>
              <label>
                Nombre
                <input
                  required
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
                  value={form.extension}
                  onChange={(event) => setForm((current) => ({ ...current, extension: event.target.value }))}
                />
              </label>
              <label>
                Procedencia
                <input
                  value={form.procedencia}
                  onChange={(event) => setForm((current) => ({ ...current, procedencia: event.target.value }))}
                />
              </label>
              <label>
                Area
                <input
                  value={form.area}
                  onChange={(event) => setForm((current) => ({ ...current, area: event.target.value }))}
                />
              </label>
              <button className="primary-button full" type="submit" disabled={saving}>
                <Plus size={18} />
                Registrar
              </button>
            </form>
          </section>
        </aside>
      </section>
    </main>
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

function StatusTile({ icon, label, state }: { icon: ReactNode; label: string; state: string | undefined }) {
  return (
    <div className="status-tile">
      <div className="status-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong className={statusClass(state)}>{state ?? "..."}</strong>
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

  if (["OK", "CONNECTED", "ANSWERED", "COMPLETED", "CLOSED", "REACHABLE", "REGISTERED", "NOT_INUSE", "INUSE", "INFO"].includes(normalized)) {
    return "good";
  }

  if (["OFF", "CONNECTING", "RINGING", "HALF_OPEN", "NEWCHANNEL", "UNKNOWN", "WARN"].includes(normalized)) {
    return "warn";
  }

  if (["FALLA", "ERROR", "DISCONNECTED", "OPEN", "HANGUP", "BUSY", "NOANSWER", "UNAVAILABLE", "UNREACHABLE", "UNREGISTERED"].includes(normalized)) {
    return "bad";
  }

  return "muted";
}

function upsertById<T extends { id: number }>(items: T[], item: T): T[] {
  const exists = items.some((current) => current.id === item.id);
  const next = exists ? items.map((current) => (current.id === item.id ? item : current)) : [item, ...items];
  return next.slice(0, 50);
}

function byExtension(a: Usuario, b: Usuario) {
  return a.extension.localeCompare(b.extension);
}

function formatTime(value: string) {
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
