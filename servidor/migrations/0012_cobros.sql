-- Cobros contra entrega (HAPPE y Tienda Directa.ar).
--
-- Quién lo ve: usuarios de Planet con cobros = 1 (se marca en Admin → Usuarios).
-- Los números 0006-0010 los usan otros bloques (Lightdata, chat, tareas),
-- por eso esta va como 0012.
ALTER TABLE usuarios ADD COLUMN cobros INTEGER NOT NULL DEFAULT 0;

-- Un envío entregado con cobro, traído de Lightdata. Lo que viene de Lightdata
-- no cambia una vez entregado; lo que se marca acá es la forma de pago.
CREATE TABLE IF NOT EXISTS cobros (
  did           INTEGER PRIMARY KEY,                -- id del envío en Lightdata
  cliente       TEXT NOT NULL,                      -- nombre en Lightdata
  tracking      TEXT NOT NULL DEFAULT '',
  destinatario  TEXT NOT NULL DEFAULT '',
  direccion     TEXT NOT NULL DEFAULT '',
  chofer        TEXT NOT NULL DEFAULT '',
  monto         INTEGER NOT NULL DEFAULT 0,         -- pesos
  entregado     TEXT NOT NULL DEFAULT '',           -- "dd/mm/aaaa hh:mm" (hora de Argentina)
  dia           TEXT NOT NULL,                      -- día de entrega, "aaaa-mm-dd"
  forma         TEXT NOT NULL DEFAULT '',           -- '' | 'efectivo' | 'transferencia'
  marcado_por   TEXT NOT NULL DEFAULT '',
  marcado_en    INTEGER NOT NULL DEFAULT 0,         -- ms
  traido_en     INTEGER NOT NULL DEFAULT 0          -- ms
);
CREATE INDEX IF NOT EXISTS idx_cobros_dia ON cobros (dia);

-- Historial: cada cambio de forma de pago, con quién y cuándo (no se borra)
CREATE TABLE IF NOT EXISTS cobros_cambios (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  did      INTEGER NOT NULL,
  antes    TEXT NOT NULL DEFAULT '',
  despues  TEXT NOT NULL DEFAULT '',
  usuario  TEXT NOT NULL,
  cuando   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cobros_cambios_did ON cobros_cambios (did, id);
