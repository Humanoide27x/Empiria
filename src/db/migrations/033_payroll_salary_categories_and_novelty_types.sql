-- ─────────────────────────────────────────────────────────────────────────────
-- 033 · Categorías salariales por contrato + Tipos oficiales de novedades
-- ─────────────────────────────────────────────────────────────────────────────

-- ── audit_logs (referenciada en setNoveltyReviewed) ──────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(60),
  entity_id   TEXT,
  action      VARCHAR(60),
  user_id     INTEGER,
  user_name   TEXT,
  reason      TEXT,
  payload     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Categorías salariales por contrato ───────────────────────────────────────
-- Una fila por (contract_id, category_code).
-- Si no existe fila para un contrato se usan los valores de payroll_config.json.
CREATE TABLE IF NOT EXISTS payroll_salary_categories (
  id                  SERIAL PRIMARY KEY,
  contract_id         INTEGER NOT NULL,
  category_code       VARCHAR(20) NOT NULL,
  base_salary         NUMERIC(14,2) NOT NULL DEFAULT 0,
  transport_allowance NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_recargos      NUMERIC(14,2) NOT NULL DEFAULT 0,
  active              BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (contract_id, category_code)
);

-- ── Tipos oficiales de novedades ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_novelty_types (
  id                  SERIAL PRIMARY KEY,
  code                VARCHAR(60) NOT NULL UNIQUE,
  name                VARCHAR(120) NOT NULL,
  -- Qué afecta esta novedad
  affects_salary      BOOLEAN NOT NULL DEFAULT false,
  affects_transport   BOOLEAN NOT NULL DEFAULT false,
  affects_recargos    BOOLEAN NOT NULL DEFAULT false,
  affects_deductions  BOOLEAN NOT NULL DEFAULT false,
  -- Flujo de cobertura y documentos
  requires_turn_cover BOOLEAN NOT NULL DEFAULT false,
  requires_support    BOOLEAN NOT NULL DEFAULT false,
  active              BOOLEAN NOT NULL DEFAULT true
);

-- Seed: 12 tipos oficiales de EMPIRIA
INSERT INTO payroll_novelty_types
  (code, name, affects_salary, affects_transport, affects_recargos, affects_deductions, requires_turn_cover, requires_support)
VALUES
  ('DIAS_NO_CLASE',                'Días de No Clase',                    false, true,  false, false, true,  false),
  ('CITA_MEDICA',                  'Cita Médica',                         false, true,  false, false, false, true ),
  ('INCAPACIDAD_MEDICA',           'Incapacidad Médica',                  false, true,  false, false, false, true ),
  ('INCAPACIDAD_ACCIDENTE_LABORAL','Incapacidad por Accidente Laboral',   false, true,  false, false, false, true ),
  ('CALAMIDAD_FAMILIAR',           'Calamidad Familiar',                  false, true,  false, false, false, false),
  ('LUTO',                         'Luto',                                false, true,  false, false, false, false),
  ('PERMISOS_NO_REMUNERADOS',      'Permisos No Remunerados',             true,  false, false, false, false, false),
  ('CITACION_COLEGIO',             'Citación en Colegio',                 false, true,  false, false, false, false),
  ('LICENCIA_MATERNIDAD_PATERNIDAD','Licencia de Maternidad/Paternidad',  false, true,  false, false, false, true ),
  ('SUSPENSION',                   'Suspensión',                          true,  false, false, false, false, false),
  ('FECHA_INGRESO',                'Fecha de Ingreso',                    true,  false, false, false, false, false),
  ('FECHA_RETIRO',                 'Fecha de Retiro',                     true,  false, false, false, false, false)
ON CONFLICT (code) DO UPDATE SET
  name                = EXCLUDED.name,
  affects_salary      = EXCLUDED.affects_salary,
  affects_transport   = EXCLUDED.affects_transport,
  affects_recargos    = EXCLUDED.affects_recargos,
  affects_deductions  = EXCLUDED.affects_deductions,
  requires_turn_cover = EXCLUDED.requires_turn_cover,
  requires_support    = EXCLUDED.requires_support;

-- ── Enriquecer payroll_items ─────────────────────────────────────────────────
-- Categoría salarial calculada (CAA1, CAA2, CAARES1…4, RI)
ALTER TABLE payroll_items
  ADD COLUMN IF NOT EXISTS salary_category VARCHAR(20),
  ADD COLUMN IF NOT EXISTS worked_days     INTEGER DEFAULT 30;

-- ── Enriquecer external_turn_workers ─────────────────────────────────────────
ALTER TABLE external_turn_workers
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(20);  -- 'AHORROS' | 'CORRIENTE'

-- ── Índices de soporte ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_psc_contract  ON payroll_salary_categories (contract_id);
CREATE INDEX IF NOT EXISTS idx_pnt_code      ON payroll_novelty_types (code) WHERE active;
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_logs (entity_type, entity_id);
