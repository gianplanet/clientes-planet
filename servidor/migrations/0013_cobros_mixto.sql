-- Cobros: pago "mixto" (parte en efectivo y parte por transferencia).
-- Solo se usan con forma = 'mixto'; con efectivo o transferencia el monto
-- entero va a esa forma y estas columnas quedan en 0. Si entre las dos no
-- llegan al monto, lo que falta cuenta como "debe" y se arrastra.
ALTER TABLE cobros ADD COLUMN pago_efectivo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cobros ADD COLUMN pago_transferencia INTEGER NOT NULL DEFAULT 0;
