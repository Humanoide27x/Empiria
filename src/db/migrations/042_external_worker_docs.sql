-- 042: columnas de documentos en external_turn_workers
ALTER TABLE external_turn_workers
  ADD COLUMN IF NOT EXISTS cedula_url        TEXT,
  ADD COLUMN IF NOT EXISTS cert_bancaria_url TEXT,
  ADD COLUMN IF NOT EXISTS cuenta_cobro_url  TEXT;
