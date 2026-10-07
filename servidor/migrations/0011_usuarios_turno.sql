-- Turno de cada persona del equipo (para las métricas por usuario).
-- Son horas de Argentina (0 a 24), puede llevar media hora (8.5 = 8:30).
-- NULL / sin turno = se mide en horas corridas, igual que el resto.
--   Ej.: Facundo 8 a 17  → turno_desde = 8,  turno_hasta = 17
--        Mario   17 a 23 → turno_desde = 17, turno_hasta = 23
ALTER TABLE usuarios ADD COLUMN turno_desde REAL;
ALTER TABLE usuarios ADD COLUMN turno_hasta REAL;
