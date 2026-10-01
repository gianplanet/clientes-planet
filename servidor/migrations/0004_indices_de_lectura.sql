-- Índices para que la actualización automática (cada 30 s, por cada persona
-- con el portal abierto) lea pocas filas. Cloudflare D1 cuenta cada fila leída.

-- 1) Buscar el usuario de una sesión: se compara en minúsculas, y sin este
--    índice cada pedido recorría la tabla de usuarios entera.
CREATE INDEX IF NOT EXISTS idx_usuarios_minusculas ON usuarios(lower(usuario));

-- 2) "Qué cambió desde X" y "último cambio" para un cliente: sin este índice
--    leía todas las consultas de esa empresa en cada revisión.
CREATE INDEX IF NOT EXISTS idx_consultas_cliente_actualizado ON consultas(cliente, actualizado);
