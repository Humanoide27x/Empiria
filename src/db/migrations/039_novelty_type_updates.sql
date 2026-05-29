-- Migration 039: Novelty type updates, support requirements, municipality unreview tracking

BEGIN;

-- ── 1. New novelty type: Cita Médica de un Familiar ─────────────────────────
INSERT INTO payroll_novelty_types
  (code, name, affects_salary, affects_transport, affects_recargos, affects_deductions, requires_turn_cover, requires_support)
VALUES
  ('CITA_MEDICA_FAMILIAR', 'Cita Médica de un Familiar', false, true, false, false, false, true)
ON CONFLICT (code) DO UPDATE SET
  name              = EXCLUDED.name,
  affects_transport = EXCLUDED.affects_transport,
  requires_support  = EXCLUDED.requires_support,
  active            = true;

-- ── 2. PERMISOS_NO_REMUNERADOS: now also affects transport + recargos ─────────
UPDATE payroll_novelty_types
   SET affects_transport = true,
       affects_recargos  = true,
       requires_support  = true
 WHERE code = 'PERMISOS_NO_REMUNERADOS';

-- ── 3. SUSPENSION: now also affects transport + recargos ─────────────────────
UPDATE payroll_novelty_types
   SET affects_transport = true,
       affects_recargos  = true
 WHERE code = 'SUSPENSION';

-- ── 4. Medical / absence types that affect adicionales (recargos) ─────────────
UPDATE payroll_novelty_types
   SET affects_recargos = true
 WHERE code IN (
   'INCAPACIDAD_MEDICA',
   'INCAPACIDAD_ACCIDENTE_LABORAL',
   'CALAMIDAD_FAMILIAR',
   'LUTO',
   'LICENCIA_MATERNIDAD_PATERNIDAD'
 );

-- ── 5. Types that now require support documentation ──────────────────────────
UPDATE payroll_novelty_types
   SET requires_support = true
 WHERE code IN ('CALAMIDAD_FAMILIAR', 'LUTO', 'CITACION_COLEGIO');

-- ── 6. Municipality status: add unreview tracking columns ────────────────────
ALTER TABLE payroll_municipality_status
  ADD COLUMN IF NOT EXISTS unreviewed_by_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS unreviewed_by_name     TEXT,
  ADD COLUMN IF NOT EXISTS unreviewed_at          TIMESTAMPTZ;

-- ── 7. External worker documents table ───────────────────────────────────────
-- La tabla ya puede existir con payroll_turn_cover_id; se crea sólo si falta.
-- No se incluye UNIQUE inline para que el CREATE TABLE IF NOT EXISTS sea seguro.
CREATE TABLE IF NOT EXISTS external_worker_documents (
  id                    SERIAL PRIMARY KEY,
  external_worker_id    INTEGER NOT NULL,
  payroll_turn_cover_id INTEGER REFERENCES payroll_turn_covers(id) ON DELETE CASCADE,
  document_type         TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','cargado','aprobado','rechazado','correccion_solicitada')),
  file_url              TEXT,
  file_name             TEXT,
  observations          TEXT,
  uploaded_by           INTEGER REFERENCES users(id),
  uploaded_at           TIMESTAMPTZ,
  reviewed_by           INTEGER REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice simple por trabajador externo
CREATE INDEX IF NOT EXISTS ewd_worker_idx
  ON external_worker_documents(external_worker_id);

-- Índice simple por turno de liquidación
CREATE INDEX IF NOT EXISTS ewd_turn_cover_idx
  ON external_worker_documents(payroll_turn_cover_id);

-- Índice único parcial: un documento por tipo cuando hay turno asignado
CREATE UNIQUE INDEX IF NOT EXISTS ewd_unique_worker_turn_type
  ON external_worker_documents(external_worker_id, payroll_turn_cover_id, document_type)
  WHERE payroll_turn_cover_id IS NOT NULL;

COMMIT;
