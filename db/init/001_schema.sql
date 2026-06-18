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
  ami_uniqueid VARCHAR(80),
  ami_linkedid VARCHAR(80),
  ultimo_evento VARCHAR(80),
  fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_contestada TIMESTAMPTZ,
  fecha_fin TIMESTAMPTZ,
  duracion_segundos INTEGER,
  eventos_count INTEGER NOT NULL DEFAULT 1,
  evidencia_key TEXT,
  raw_event JSONB
);

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

CREATE INDEX IF NOT EXISTS idx_llamada_eventos_llamada ON llamada_eventos (llamada_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS auditoria_acciones (
  id SERIAL PRIMARY KEY,
  actor VARCHAR(100) NOT NULL,
  accion VARCHAR(80) NOT NULL,
  entidad VARCHAR(80),
  entidad_id VARCHAR(100),
  detalle JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auditoria_acciones_creado ON auditoria_acciones (creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_acciones_entidad ON auditoria_acciones (entidad, entidad_id);

INSERT INTO usuarios (nombre, extension, procedencia, area)
VALUES
  ('Juan Perez', '1001', 'Red Empresa', 'Soporte'),
  ('Maria Lopez', '1002', 'Red Empresa', 'Agente'),
  ('Equipo Marketing', '2001', 'Red Empresa', 'Marketing'),
  ('Asesor Ventas', '3001', 'Red Empresa', 'Ventas'),
  ('Supervisor Call Center', '4001', 'Red Empresa', 'Supervisores'),
  ('Cliente Carlos', '9001', 'Red Clientes Simulados', 'Cliente interesado'),
  ('Cliente Maria', '9002', 'Red Clientes Simulados', 'Cliente ventas'),
  ('Cliente Empresa Demo', '9003', 'Red Clientes Simulados', 'Cliente empresa'),
  ('Cliente Reclamo', '9004', 'Red Clientes Simulados', 'Cliente reclamo'),
  ('Cliente Interesado', '9005', 'Red Clientes Simulados', 'Cliente interesado')
ON CONFLICT (extension) DO NOTHING;
