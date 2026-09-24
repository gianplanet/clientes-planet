-- 1) Límite de intentos de login: sin esto se pueden probar contraseñas sin parar.
--    Una fila por intento fallido; "clave" es 'u:<usuario>' o 'ip:<dirección>'.
CREATE TABLE IF NOT EXISTS intentos_login (
  clave  TEXT NOT NULL,
  cuando INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intentos_clave ON intentos_login(clave, cuando);

-- 2) Consultas sin "último cambio" (quedaron en 0 al migrar desde la planilla).
--    Ese dato decide qué consultas cerradas se cargan de entrada, así que se
--    completa con lo último que se sabe de cada una.
UPDATE consultas SET actualizado = MAX(
  creado_en,
  COALESCE(cerrado_en, 0),
  COALESCE(reabierta_en, 0),
  COALESCE((SELECT MAX(m.creado_en) FROM mensajes m WHERE m.consulta_id = consultas.id), 0)
)
WHERE actualizado = 0;
