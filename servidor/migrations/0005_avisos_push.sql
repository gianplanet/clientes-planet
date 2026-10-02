-- Avisos al teléfono: cada navegador que los activa deja acá su "dirección"
-- (endpoint) y las dos claves con las que hay que cifrarle los mensajes.
-- Si la persona entra desde el celular y desde la compu, son dos filas.
CREATE TABLE IF NOT EXISTS suscripciones (
  endpoint  TEXT PRIMARY KEY,
  usuario   TEXT NOT NULL,
  p256dh    TEXT NOT NULL,
  auth      TEXT NOT NULL,
  creado_en INTEGER NOT NULL DEFAULT 0
);

-- Para buscar rápido a quién hay que avisarle
CREATE INDEX IF NOT EXISTS idx_suscripciones_usuario ON suscripciones(usuario);
