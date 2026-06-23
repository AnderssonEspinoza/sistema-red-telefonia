import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const terminalStates = new Set([
  "BUSY",
  "CANCEL",
  "CHANUNAVAIL",
  "COMPLETED",
  "CONGESTION",
  "FAILED",
  "HANGUP",
  "NOANSWER"
]);

export interface Usuario {
  id: number;
  nombre: string;
  extension: string;
  procedencia: string | null;
  area: string | null;
  estado: string;
  creado_en: string;
}

export interface Llamada {
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
  raw_event: Record<string, unknown> | null;
}

export interface AuditAction {
  id: number;
  actor: string;
  accion: string;
  entidad: string | null;
  entidad_id: string | null;
  detalle: Record<string, unknown> | null;
  creado_en: string;
}

export interface NuevaLlamada {
  extensionOrigen?: string | null;
  extensionDestino?: string | null;
  estado: string;
  fuente: string;
  rawEvent?: Record<string, unknown> | null;
}

export interface AmiLlamadaInput extends NuevaLlamada {
  eventType: string;
  amiUniqueId?: string | null;
  amiLinkedId?: string | null;
}

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      extension VARCHAR(10) UNIQUE NOT NULL,
      procedencia VARCHAR(100),
      area VARCHAR(100),
      estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
      creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS llamadas (
      id SERIAL PRIMARY KEY,
      extension_origen VARCHAR(10),
      extension_destino VARCHAR(10),
      nombre_origen VARCHAR(100),
      nombre_destino VARCHAR(100),
      estado VARCHAR(50) NOT NULL,
      fuente VARCHAR(30) NOT NULL DEFAULT 'manual',
      fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_fin TIMESTAMPTZ,
      duracion_segundos INTEGER,
      raw_event JSONB
    );

    ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS ami_uniqueid VARCHAR(80);
    ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS ami_linkedid VARCHAR(80);
    ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS ultimo_evento VARCHAR(80);
    ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS fecha_contestada TIMESTAMPTZ;
    ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS eventos_count INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS evidencia_key TEXT;

    CREATE INDEX IF NOT EXISTS idx_llamadas_fecha_inicio ON llamadas (fecha_inicio DESC);
    CREATE INDEX IF NOT EXISTS idx_llamadas_origen ON llamadas (extension_origen);
    CREATE INDEX IF NOT EXISTS idx_llamadas_destino ON llamadas (extension_destino);
    CREATE INDEX IF NOT EXISTS idx_llamadas_ami_uniqueid ON llamadas (ami_uniqueid);
    CREATE INDEX IF NOT EXISTS idx_llamadas_ami_linkedid ON llamadas (ami_linkedid);

    CREATE TABLE IF NOT EXISTS llamada_eventos (
      id SERIAL PRIMARY KEY,
      llamada_id INTEGER NOT NULL REFERENCES llamadas(id) ON DELETE CASCADE,
      tipo VARCHAR(80) NOT NULL,
      estado VARCHAR(50) NOT NULL,
      raw_event JSONB,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_llamada_eventos_llamada
      ON llamada_eventos (llamada_id, creado_en DESC);

    CREATE TABLE IF NOT EXISTS auditoria_acciones (
      id SERIAL PRIMARY KEY,
      actor VARCHAR(100) NOT NULL,
      accion VARCHAR(80) NOT NULL,
      entidad VARCHAR(80),
      entidad_id VARCHAR(100),
      detalle JSONB,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_auditoria_acciones_creado
      ON auditoria_acciones (creado_en DESC);
    CREATE INDEX IF NOT EXISTS idx_auditoria_acciones_entidad
      ON auditoria_acciones (entidad, entidad_id);
  `);
}

export async function checkDatabase() {
  await pool.query("SELECT 1");
}

export async function listUsuarios(): Promise<Usuario[]> {
  const result = await pool.query<Usuario>("SELECT * FROM usuarios ORDER BY extension ASC");
  return result.rows;
}

export async function findUsuarioByExtension(extension: string | null | undefined): Promise<Usuario | null> {
  if (!extension) {
    return null;
  }

  const result = await pool.query<Usuario>("SELECT * FROM usuarios WHERE extension = $1 LIMIT 1", [extension]);
  return result.rows[0] ?? null;
}

export async function createUsuario(input: {
  nombre: string;
  extension: string;
  procedencia?: string | null;
  area?: string | null;
}): Promise<Usuario> {
  const result = await pool.query<Usuario>(
    `INSERT INTO usuarios (nombre, extension, procedencia, area)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.nombre, input.extension, input.procedencia ?? null, input.area ?? null]
  );

  return result.rows[0];
}

export async function updateUsuarioByExtension(
  extension: string,
  input: {
    nombre: string;
    procedencia?: string | null;
    area?: string | null;
  }
): Promise<Usuario | null> {
  const result = await pool.query<Usuario>(
    `UPDATE usuarios
     SET nombre = $1,
         procedencia = $2,
         area = $3
     WHERE extension = $4
     RETURNING *`,
    [input.nombre, input.procedencia ?? null, input.area ?? null, extension]
  );

  return result.rows[0] ?? null;
}

export async function listAuditActions(limit = 50): Promise<AuditAction[]> {
  const result = await pool.query<AuditAction>(
    `SELECT *
     FROM auditoria_acciones
     ORDER BY creado_en DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function recordAuditAction(input: {
  actor: string;
  accion: string;
  entidad?: string | null;
  entidadId?: string | number | null;
  detalle?: Record<string, unknown> | null;
}): Promise<AuditAction> {
  const result = await pool.query<AuditAction>(
    `INSERT INTO auditoria_acciones (actor, accion, entidad, entidad_id, detalle)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.actor,
      input.accion,
      input.entidad ?? null,
      input.entidadId === undefined || input.entidadId === null ? null : String(input.entidadId),
      input.detalle ?? null
    ]
  );

  return result.rows[0];
}

export async function listLlamadas(limit = 50): Promise<Llamada[]> {
  const result = await pool.query<Llamada>(
    `SELECT *
     FROM llamadas
     ORDER BY fecha_inicio DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getCallStats() {
  const [totals, bySource, byState] = await Promise.all([
    pool.query<{
      total: string;
      active: string;
      with_evidence: string;
      recent_total: string;
      recent_with_evidence: string;
      avg_duration: string | null;
      last_call_at: string | null;
    }>(
      `SELECT
         COUNT(*)::TEXT AS total,
         COUNT(*) FILTER (
           WHERE fecha_fin IS NULL AND estado IN ('RINGING', 'ANSWERED', 'NEWCHANNEL')
         )::TEXT AS active,
         COUNT(*) FILTER (WHERE evidencia_key IS NOT NULL)::TEXT AS with_evidence,
         COUNT(*) FILTER (WHERE fecha_inicio >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::TEXT AS recent_total,
         COUNT(*) FILTER (
           WHERE fecha_inicio >= CURRENT_TIMESTAMP - INTERVAL '24 hours' AND evidencia_key IS NOT NULL
         )::TEXT AS recent_with_evidence,
         ROUND(AVG(duracion_segundos))::TEXT AS avg_duration,
         MAX(fecha_inicio)::TEXT AS last_call_at
       FROM llamadas`
    ),
    pool.query<{ fuente: string; total: string }>(
      `SELECT fuente, COUNT(*)::TEXT AS total
       FROM llamadas
       GROUP BY fuente
       ORDER BY fuente ASC`
    ),
    pool.query<{ estado: string; total: string }>(
      `SELECT estado, COUNT(*)::TEXT AS total
       FROM llamadas
       GROUP BY estado
       ORDER BY total DESC`
    )
  ]);

  const row = totals.rows[0];

  return {
    total: Number(row.total),
    active: Number(row.active),
    withEvidence: Number(row.with_evidence),
    evidenceCoveragePercent: Number(row.total) > 0 ? Math.round((Number(row.with_evidence) / Number(row.total)) * 100) : 0,
    recentTotal: Number(row.recent_total),
    recentWithEvidence: Number(row.recent_with_evidence),
    recentEvidenceCoveragePercent:
      Number(row.recent_total) > 0 ? Math.round((Number(row.recent_with_evidence) / Number(row.recent_total)) * 100) : 0,
    averageDurationSeconds: row.avg_duration === null ? null : Number(row.avg_duration),
    lastCallAt: row.last_call_at,
    bySource: bySource.rows.map((item) => ({ fuente: item.fuente, total: Number(item.total) })),
    byState: byState.rows.map((item) => ({ estado: item.estado, total: Number(item.total) }))
  };
}

export async function createLlamada(input: NuevaLlamada): Promise<Llamada> {
  const [origen, destino] = await Promise.all([
    findUsuarioByExtension(input.extensionOrigen),
    findUsuarioByExtension(input.extensionDestino)
  ]);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query<Llamada>(
      `INSERT INTO llamadas (
          extension_origen,
          extension_destino,
          nombre_origen,
          nombre_destino,
          estado,
          fuente,
          ultimo_evento,
          raw_event
        )
        VALUES ($1, $2, $3, $4, $5, $6, $5, $7)
        RETURNING *`,
      [
        input.extensionOrigen ?? null,
        input.extensionDestino ?? null,
        origen?.nombre ?? null,
        destino?.nombre ?? null,
        input.estado,
        input.fuente,
        input.rawEvent ?? null
      ]
    );

    const llamada = result.rows[0];
    await insertLlamadaEvento(client, llamada.id, input.fuente, input.estado, input.rawEvent ?? null);
    await client.query("COMMIT");
    return llamada;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertAmiLlamada(input: AmiLlamadaInput): Promise<Llamada> {
  const [origen, destino] = await Promise.all([
    findUsuarioByExtension(input.extensionOrigen),
    findUsuarioByExtension(input.extensionDestino)
  ]);

  const estado = input.estado.toUpperCase();
  const isAnswered = estado === "ANSWERED";
  const isTerminal = terminalStates.has(estado);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query<Llamada>(
      `SELECT *
       FROM llamadas
       WHERE
         ($1::VARCHAR IS NOT NULL AND ami_linkedid = $1)
         OR ($2::VARCHAR IS NOT NULL AND ami_uniqueid = $2)
       ORDER BY fecha_inicio DESC
       LIMIT 1
       FOR UPDATE`,
      [input.amiLinkedId ?? null, input.amiUniqueId ?? null]
    );

    let llamada: Llamada;

    if (existing.rows[0]) {
      const updated = await client.query<Llamada>(
        `UPDATE llamadas
         SET
           extension_origen = COALESCE($1::VARCHAR, extension_origen),
           extension_destino = COALESCE($2::VARCHAR, extension_destino),
           nombre_origen = COALESCE($3::VARCHAR, nombre_origen),
           nombre_destino = COALESCE($4::VARCHAR, nombre_destino),
           estado = $5,
           fuente = 'ami',
           raw_event = $6::JSONB,
           ami_uniqueid = COALESCE($7::VARCHAR, ami_uniqueid),
           ami_linkedid = COALESCE($8::VARCHAR, ami_linkedid),
           ultimo_evento = $9,
           eventos_count = eventos_count + 1,
           fecha_contestada = CASE
             WHEN $10::BOOLEAN AND fecha_contestada IS NULL THEN CURRENT_TIMESTAMP
             ELSE fecha_contestada
           END,
           fecha_fin = CASE
             WHEN $11::BOOLEAN AND fecha_fin IS NULL THEN CURRENT_TIMESTAMP
             ELSE fecha_fin
           END,
           duracion_segundos = CASE
             WHEN $11::BOOLEAN THEN COALESCE(
               duracion_segundos,
               GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - fecha_inicio))::INTEGER)
             )
             ELSE duracion_segundos
           END
         WHERE id = $12
         RETURNING *`,
        [
          input.extensionOrigen ?? null,
          input.extensionDestino ?? null,
          origen?.nombre ?? null,
          destino?.nombre ?? null,
          estado,
          input.rawEvent ?? null,
          input.amiUniqueId ?? null,
          input.amiLinkedId ?? input.amiUniqueId ?? null,
          input.eventType,
          isAnswered,
          isTerminal,
          existing.rows[0].id
        ]
      );
      llamada = updated.rows[0];
    } else {
      const inserted = await client.query<Llamada>(
        `INSERT INTO llamadas (
            extension_origen,
            extension_destino,
            nombre_origen,
            nombre_destino,
            estado,
            fuente,
            ami_uniqueid,
            ami_linkedid,
            ultimo_evento,
            fecha_contestada,
            fecha_fin,
            duracion_segundos,
            raw_event
          )
          VALUES (
            $1, $2, $3, $4, $5, 'ami', $6, $7, $8,
            CASE WHEN $9::BOOLEAN THEN CURRENT_TIMESTAMP ELSE NULL END,
            CASE WHEN $10::BOOLEAN THEN CURRENT_TIMESTAMP ELSE NULL END,
            CASE WHEN $10::BOOLEAN THEN 0 ELSE NULL END,
            $11
          )
          RETURNING *`,
        [
          input.extensionOrigen ?? null,
          input.extensionDestino ?? null,
          origen?.nombre ?? null,
          destino?.nombre ?? null,
          estado,
          input.amiUniqueId ?? null,
          input.amiLinkedId ?? input.amiUniqueId ?? null,
          input.eventType,
          isAnswered,
          isTerminal,
          input.rawEvent ?? null
        ]
      );
      llamada = inserted.rows[0];
    }

    if (isTerminal) {
      await closeRelatedAmiCalls(client, llamada, input.amiLinkedId ?? input.amiUniqueId ?? null, input.amiUniqueId ?? null);
    }

    await insertLlamadaEvento(client, llamada.id, input.eventType, estado, input.rawEvent ?? null);
    await client.query("COMMIT");
    return llamada;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function closeRelatedAmiCalls(client: pg.PoolClient, llamada: Llamada, linkedId: string | null, uniqueId: string | null) {
  if (!linkedId && !uniqueId) {
    return;
  }

  await client.query(
    `UPDATE llamadas
     SET
       estado = 'HANGUP',
       ultimo_evento = COALESCE(ultimo_evento, 'Hangup'),
       fecha_fin = COALESCE(fecha_fin, CURRENT_TIMESTAMP),
       duracion_segundos = COALESCE(
         duracion_segundos,
         GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - fecha_inicio))::INTEGER)
       )
     WHERE id <> $1
       AND fecha_fin IS NULL
       AND fuente = 'ami'
       AND (
         ($2::VARCHAR IS NOT NULL AND (ami_linkedid = $2 OR ami_uniqueid = $2))
         OR ($3::VARCHAR IS NOT NULL AND (ami_linkedid = $3 OR ami_uniqueid = $3))
       )`,
    [llamada.id, linkedId, uniqueId]
  );
}

export async function setLlamadaEvidence(id: number, evidenceKey: string): Promise<Llamada | null> {
  const result = await pool.query<Llamada>(
    `UPDATE llamadas
     SET evidencia_key = $2
     WHERE id = $1
     RETURNING *`,
    [id, evidenceKey]
  );

  return result.rows[0] ?? null;
}

export async function finalizarLlamada(id: number): Promise<Llamada | null> {
  const result = await pool.query<Llamada>(
    `UPDATE llamadas
     SET
       estado = 'COMPLETED',
       ultimo_evento = 'MANUAL_END',
       eventos_count = eventos_count + 1,
       fecha_fin = CURRENT_TIMESTAMP,
       duracion_segundos = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - fecha_inicio))::INTEGER
     WHERE id = $1
     RETURNING *`,
    [id]
  );

  const llamada = result.rows[0] ?? null;

  if (llamada) {
    await pool.query(
      `INSERT INTO llamada_eventos (llamada_id, tipo, estado, raw_event)
       VALUES ($1, $2, $3, $4)`,
      [llamada.id, "MANUAL_END", "COMPLETED", { id }]
    );
  }

  return llamada;
}

async function insertLlamadaEvento(
  client: pg.PoolClient,
  llamadaId: number,
  tipo: string,
  estado: string,
  rawEvent: Record<string, unknown> | null
) {
  await client.query(
    `INSERT INTO llamada_eventos (llamada_id, tipo, estado, raw_event)
     VALUES ($1, $2, $3, $4)`,
    [llamadaId, tipo, estado, rawEvent]
  );
}
