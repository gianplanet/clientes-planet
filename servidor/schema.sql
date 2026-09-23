-- Portal Clientes Planet — estructura de la base de datos (Cloudflare D1)
-- Reemplaza las hojas PortalUsuarios / PortalConsultas / PortalClientes / PortalNotas

DROP TABLE IF EXISTS sesiones;
DROP TABLE IF EXISTS mensajes;
DROP TABLE IF EXISTS consultas;
DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS notas;
DROP TABLE IF EXISTS usuarios;

-- ── USUARIOS ──────────────────────────────────────────────
-- Antes: hoja PortalUsuarios (usuario|nombre|password|team|cliente|role)
-- Cambio: la contraseña ya no se guarda en texto plano, sino encriptada.
CREATE TABLE usuarios (
  usuario       TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  team          TEXT NOT NULL DEFAULT 'cliente',   -- 'planet' | 'cliente'
  cliente       TEXT NOT NULL DEFAULT '-',
  role          TEXT NOT NULL DEFAULT 'user'       -- 'admin' | 'user'
);

-- ── CONSULTAS ─────────────────────────────────────────────
-- Antes: hoja PortalConsultas. La columna "mensajes" (un JSON gigante
-- dentro de la celda) pasa a ser la tabla mensajes de abajo.
CREATE TABLE consultas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha          TEXT NOT NULL,
  asunto         TEXT NOT NULL,
  cliente        TEXT NOT NULL,
  direccion      TEXT NOT NULL DEFAULT 'cliente_a_planet',
  estado         TEXT NOT NULL DEFAULT 'Abierto',
  creado_por     TEXT NOT NULL,
  nombre_creador TEXT NOT NULL DEFAULT '',
  atendido_por   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_consultas_cliente ON consultas(cliente);
CREATE INDEX idx_consultas_estado  ON consultas(estado);
CREATE INDEX idx_consultas_id_desc ON consultas(id DESC);

-- ── MENSAJES ──────────────────────────────────────────────
-- Cada respuesta dentro de una consulta es ahora una fila propia.
-- Esto es lo que evita que se trabe cuando varios responden a la vez.
CREATE TABLE mensajes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  consulta_id INTEGER NOT NULL,
  autor       TEXT NOT NULL,
  nombre      TEXT NOT NULL DEFAULT '',
  fecha       TEXT NOT NULL,
  texto       TEXT NOT NULL DEFAULT '',
  imagenes    TEXT,                                -- JSON array de URLs, o NULL
  FOREIGN KEY (consulta_id) REFERENCES consultas(id) ON DELETE CASCADE
);
CREATE INDEX idx_mensajes_consulta ON mensajes(consulta_id, id);

-- ── CLIENTES ──────────────────────────────────────────────
-- Antes: hoja PortalClientes
CREATE TABLE clientes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  contacto   TEXT NOT NULL DEFAULT '',
  telefono   TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  direccion  TEXT NOT NULL DEFAULT '',
  notas      TEXT NOT NULL DEFAULT '',
  fecha_alta TEXT NOT NULL DEFAULT ''
);

-- ── NOTAS (post-its de Planet) ────────────────────────────
-- Antes: hoja PortalNotas
CREATE TABLE notas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  texto           TEXT NOT NULL DEFAULT '',
  color           TEXT NOT NULL DEFAULT '',
  pin             INTEGER NOT NULL DEFAULT 0,      -- 0/1 en vez de true/false
  autor           TEXT NOT NULL,
  nombre_autor    TEXT NOT NULL DEFAULT '',
  fecha           TEXT NOT NULL DEFAULT '',
  actualizado     TEXT NOT NULL DEFAULT '',
  actualizado_por TEXT NOT NULL DEFAULT '',
  x               REAL,
  y               REAL,
  min             INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_notas_autor ON notas(autor);

-- ── SESIONES ──────────────────────────────────────────────
-- Antes: ScriptProperties de Apps Script. Token de 30 días.
CREATE TABLE sesiones (
  token   TEXT PRIMARY KEY,
  usuario TEXT NOT NULL,
  expira  INTEGER NOT NULL                          -- timestamp en milisegundos
);
CREATE INDEX idx_sesiones_expira ON sesiones(expira);
