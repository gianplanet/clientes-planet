-- Portal Clientes Planet — estructura de la base (Cloudflare D1)
--
-- Es la foto de la base tal como estaba en producción el 24/09/2026.
-- Todo es "si no existe": aplicada sobre la base de producción no cambia
-- nada, y en una base vacía (las pruebas) la arma completa.
--
-- Los cambios que vengan van en archivos nuevos (0002_..., 0003_...).
-- Nunca se edita una migración que ya se aplicó.

-- ── USUARIOS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  usuario       TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,                     -- pbkdf2$iteraciones$sal$resumen
  team          TEXT NOT NULL DEFAULT 'cliente',   -- 'planet' | 'cliente'
  cliente       TEXT NOT NULL DEFAULT '-',
  role          TEXT NOT NULL DEFAULT 'user'       -- 'admin' | 'user'
);

-- ── CONSULTAS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultas (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha            TEXT NOT NULL,                  -- "dd/mm/aaaa hh:mm" hora de Argentina (para mostrar)
  asunto           TEXT NOT NULL,                  -- "referencia · cliente · tipo"
  cliente          TEXT NOT NULL,
  direccion        TEXT NOT NULL DEFAULT 'cliente_a_planet',   -- o 'planet_a_cliente'
  estado           TEXT NOT NULL DEFAULT 'Abierto',
  creado_por       TEXT NOT NULL,
  nombre_creador   TEXT NOT NULL DEFAULT '',
  atendido_por     TEXT NOT NULL DEFAULT '',
  actualizado      INTEGER NOT NULL DEFAULT 0,     -- último cambio (ms): lo usa la actualización automática
  tipo             TEXT NOT NULL DEFAULT '',       -- tipo de problema
  creado_en        INTEGER NOT NULL DEFAULT 0,     -- alta (ms)
  cerrado_en       INTEGER,                        -- cierre (ms); NULL si está abierta
  cierre_aprox     INTEGER NOT NULL DEFAULT 0,     -- 1 = cierre estimado (anterior a las métricas)
  excluir_metricas INTEGER NOT NULL DEFAULT 0,     -- 1 = no cuenta en métricas (limpieza del 24/09)
  reabierta_en     INTEGER,                        -- última vez que se reabrió (ms)
  reaberturas      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_consultas_cliente     ON consultas(cliente);
CREATE INDEX IF NOT EXISTS idx_consultas_estado      ON consultas(estado);
CREATE INDEX IF NOT EXISTS idx_consultas_id_desc     ON consultas(id DESC);
CREATE INDEX IF NOT EXISTS idx_consultas_actualizado ON consultas(actualizado);

-- ── MENSAJES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mensajes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  consulta_id INTEGER NOT NULL,
  autor       TEXT NOT NULL,
  nombre      TEXT NOT NULL DEFAULT '',
  fecha       TEXT NOT NULL,
  texto       TEXT NOT NULL DEFAULT '',
  imagenes    TEXT,                                -- JSON con las URLs, o NULL
  creado_en   INTEGER NOT NULL DEFAULT 0,          -- ms
  equipo      TEXT NOT NULL DEFAULT '',            -- 'planet' | 'cliente'
  FOREIGN KEY (consulta_id) REFERENCES consultas(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mensajes_consulta ON mensajes(consulta_id, id);

-- ── EVENTOS (historial de cada consulta, para las métricas) ──
CREATE TABLE IF NOT EXISTS eventos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  consulta_id INTEGER NOT NULL,
  evento      TEXT NOT NULL,                       -- 'creada' | 'estado' | 'mensaje' | 'reabierta'
  de_estado   TEXT NOT NULL DEFAULT '',
  a_estado    TEXT NOT NULL DEFAULT '',
  quien       TEXT NOT NULL DEFAULT '',
  nombre      TEXT NOT NULL DEFAULT '',
  equipo      TEXT NOT NULL DEFAULT '',
  cuando      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eventos_consulta ON eventos(consulta_id, cuando);
CREATE INDEX IF NOT EXISTS idx_eventos_cuando   ON eventos(cuando);

-- ── CLIENTES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  contacto   TEXT NOT NULL DEFAULT '',
  telefono   TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  direccion  TEXT NOT NULL DEFAULT '',
  notas      TEXT NOT NULL DEFAULT '',
  fecha_alta TEXT NOT NULL DEFAULT ''
);

-- ── NOTAS (post-its personales de Planet) ─────────────────
CREATE TABLE IF NOT EXISTS notas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  texto           TEXT NOT NULL DEFAULT '',
  color           TEXT NOT NULL DEFAULT '',
  pin             INTEGER NOT NULL DEFAULT 0,
  autor           TEXT NOT NULL,
  nombre_autor    TEXT NOT NULL DEFAULT '',
  fecha           TEXT NOT NULL DEFAULT '',
  actualizado     TEXT NOT NULL DEFAULT '',
  actualizado_por TEXT NOT NULL DEFAULT '',
  x               REAL,                            -- fracción del ancho
  y               REAL,                            -- píxeles desde arriba
  min             INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notas_autor ON notas(autor);

-- ── SESIONES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sesiones (
  token   TEXT PRIMARY KEY,
  usuario TEXT NOT NULL,
  expira  INTEGER NOT NULL                         -- ms
);
CREATE INDEX IF NOT EXISTS idx_sesiones_expira ON sesiones(expira);
