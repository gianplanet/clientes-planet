-- Arreglo de las fechas de lo que vino de la planilla de Google.
--
-- 1) En la planilla, la fecha de muchas consultas quedó como número de serie
--    de Google Sheets ("46274" = días desde el 30/12/1899 = 09/09/2026).
--    Se leyó como si fuera el año 46274: esas consultas se ordenaban como las
--    más nuevas, mostraban "46274" y podían contar en las métricas.
--    Se pasa a "dd/mm/aaaa" y se recalcula el alta (medianoche de Argentina = 03:00 UTC).
UPDATE consultas SET
  creado_en = CAST(ROUND((CAST(fecha AS REAL) - 25569) * 86400000) AS INTEGER) + 10800000,
  fecha = strftime(
    CASE WHEN CAST(fecha AS REAL) = CAST(CAST(fecha AS REAL) AS INTEGER) THEN '%d/%m/%Y' ELSE '%d/%m/%Y %H:%M' END,
    (CAST(fecha AS REAL) - 25569) * 86400, 'unixepoch')
WHERE fecha GLOB '[0-9][0-9][0-9][0-9][0-9]' OR fecha GLOB '[0-9][0-9][0-9][0-9][0-9].[0-9]*';

-- 2) Los mensajes viejos tienen la fecha como "8/9/26" (día/mes/año corto, sin hora).
--    Unos quedaron sin momento (0) y otros se leyeron al revés, como mes/día
--    ("9 de agosto" en vez de "8 de septiembre"). Se recalcula leyéndola bien.
WITH partes AS (
  SELECT id,
         CAST(substr(fecha, 1, instr(fecha, '/') - 1) AS INTEGER) AS dia,
         substr(fecha, instr(fecha, '/') + 1) AS resto
  FROM mensajes
  WHERE length(fecha) <= 8 AND fecha GLOB '[0-9]*/[0-9]*/[0-9][0-9]'
), fechas AS (
  SELECT id, dia,
         CAST(substr(resto, 1, instr(resto, '/') - 1) AS INTEGER) AS mes,
         2000 + CAST(substr(resto, instr(resto, '/') + 1) AS INTEGER) AS anio
  FROM partes
)
UPDATE mensajes SET
  creado_en = CAST(strftime('%s', printf('%04d-%02d-%02d', fechas.anio, fechas.mes, fechas.dia)) AS INTEGER) * 1000 + 10800000,
  fecha = printf('%02d/%02d/%04d', fechas.dia, fechas.mes, fechas.anio)
FROM fechas
WHERE mensajes.id = fechas.id AND fechas.mes BETWEEN 1 AND 12 AND fechas.dia BETWEEN 1 AND 31;

-- 3) Cualquier alta que haya quedado imposible (antes del 2000 o en el futuro)
--    se toma del primer mensaje.
UPDATE consultas SET creado_en = COALESCE(
  (SELECT MIN(m.creado_en) FROM mensajes m WHERE m.consulta_id = consultas.id AND m.creado_en > 946684800000), 0)
WHERE creado_en < 946684800000 OR creado_en > CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 86400000;
