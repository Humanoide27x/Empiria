-- Migration 039: Novelty type updates, payroll_municipality_status audit columns,
--               and external_worker_documents table for turn-cover document tracking

BEGIN;

-- ── 1. Agregar / actualizar tipo CITA_MEDICA_FAMILIAR ────────────────────────
INSERT INTO payroll_novelty_types
  (code, name, affects_salary, affects_transport, affects_recargos,
   affects_deductions, requires_turn_cover, requires_support)
VALUES
  ('CITA_MEDICA_FAMILIAR', 'Cita Médica Familiar', false, true, false, false, false, true)
ON CONFLICT (code) DO UPDATE SET
  name                = EXCLUDED.name,
  affects_salary      = EXCLUDED.affects_salary,
  affects_transport   = EXCLUDED.affects_transport,
  affects_recargos    = EXCLUDED.affects_recargos,
  affects_deductions  = EXCLUDED.affects_deductions,
  requires_turn_cover = EXCLUDED.requires_turn_cover,
  requires_support    = EXCLUDED.requires_support;

-- ── 2. Actualizar tipos existentes según lógica PAE ─────────────────────────
-- Reglas:
--   affects_salary      → descuenta del salario base (permisos no remunerados, suspensión, fechas)
--   affects_transport   → descuenta del aux. transporte (ausencias justificadas con pago)
--   affects_recargos    → descuenta recargos adicionales (solo tipos que los generan)
--   requires_support    → requiere documento de respaldo físico
--   requires_turn_cover → genera turno que debe cubrirse (días de no clase)

INSERT INTO payroll_novelty_types
  (code, name, affects_salary, affects_transport, affects_recargos,
   affects_deductions, requires_turn_cover, requires_support)
VALUES
  ('DIAS_NO_CLASE',                 'Días de No Clase',                   false, true,  false, false, true,  false),
  ('CITA_MEDICA',                   'Cita Médica',                        false, true,  false, false, false, true ),
  ('INCAPACIDAD_MEDICA',            'Incapacidad Médica',                 false, true,  false, false, false, true ),
  ('INCAPACIDAD_ACCIDENTE_LABORAL', 'Incapacidad por Accidente Laboral',  false, true,  false, false, false, true ),
  ('CALAMIDAD_FAMILIAR',            'Calamidad Familiar',                 false, true,  false, false, false, false),
  ('LUTO',                          'Luto',                               false, true,  false, false, false, false),
  ('PERMISOS_NO_REMUNERADOS',       'Permisos No Remunerados',            true,  false, false, false, false, false),
  ('CITACION_COLEGIO',              'Citación en Colegio',                false, true,  false, false, false, false),
  ('LICENCIA_MATERNIDAD_PATERNIDAD','Licencia de Maternidad/Paternidad',  false, true,  false, false, false, true ),
  ('SUSPENSION',                    'Suspensión',                         true,  false, false, false, false, false),
  ('FECHA_INGRESO',                 'Fecha de Ingreso',                   true,  false, false, false, false, false),
  ('FECHA_RETIRO',                  'Fecha de Retiro',                    true,  false, false, false, false, false)
ON CONFLICT (code) DO UPDATE SET
  name                = EXCLUDED.name,
  affects_salary      = EXCLUDED.affects_salary,
  affects_transport   = EXCLUDED.affects_transport,
  affects_recargos    = EXCLUDED.affects_recargos,
  affects_deductions  = EXCLUDED.affects_deductions,
  requires_turn_cover = EXCLUDED.requires_turn_cover,
  requires_support    = EXCLUDED.requires_support;

-- ── 3. Columnas de auditoría de des-revisión en payroll_municipality_status ──
ALTER TABLE payroll_municipality_status
  ADD COLUMN IF NOT EXISTS unreviewed_by      INTEGER,
  ADD COLUMN IF NOT EXISTS unreviewed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS unreviewed_at      TIMESTAMPTZ;

-- ── 4. Tabla de documentos de trabajadores externos (turnos externos) ────────
CREATE TABLE IF NOT EXISTS external_worker_documents (
  id                    SERIAL PRIMARY KEY,
  external_worker_id    INTEGER NOT NULL
                          REFERENCES external_turn_workers(id) ON DELETE CASCADE,
  payroll_turn_cover_id INTEGER
                          REFERENCES payroll_turn_covers(id) ON DELETE SET NULL,
  document_type         TEXT NOT NULL
                          CHECK (document_type IN (
                            'CEDULA_DE_CIUDADANIA',
                            'CUENTA_DE_COBRO',
                            'CERTIFICACION_BANCARIA'
                          )),
  status                TEXT NOT NULL DEFAULT 'pendiente'
                          CHECK (status IN ('pendiente','cargado','aprobado','rechazado')),
  file_url              TEXT,
  file_name             TEXT,
  observations          TEXT,
  uploaded_by           INTEGER,
  uploaded_at           TIMESTAMPTZ,
  reviewed_by           INTEGER,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ewd_worker_idx
  ON external_worker_documents(external_worker_id);

CREATE INDEX IF NOT EXISTS ewd_cover_idx
  ON external_worker_documents(payroll_turn_cover_id);

CREATE INDEX IF NOT EXISTS ewd_status_idx
  ON external_worker_documents(status);

-- Un trabajador externo solo puede tener un documento de cada tipo por cobertura
CREATE UNIQUE INDEX IF NOT EXISTS ewd_worker_cover_type_uk
  ON external_worker_documents(external_worker_id, payroll_turn_cover_id, document_type)
  WHERE payroll_turn_cover_id IS NOT NULL;

COMMIT;
