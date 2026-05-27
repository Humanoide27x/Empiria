-- ─────────────────────────────────────────────────────────────────────────────
-- 034 — Cambio Operativo de Cobertura
-- Nueva novedad oficial para cambios temporales o definitivos de
-- modalidad / sede / jornada / institución dentro del período de nómina.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. extra_data JSONB en payroll_novelties (almacena contexto original y nuevo)
ALTER TABLE payroll_novelties
  ADD COLUMN IF NOT EXISTS extra_data JSONB;

-- 2. Registrar el nuevo tipo oficial
INSERT INTO payroll_novelty_types (
  code, name,
  affects_salary, affects_transport,
  requires_turn_cover, requires_support, active
) VALUES (
  'CAMBIO_OPERATIVO_COBERTURA',
  'Cambio Operativo de Cobertura',
  true, true,
  false, false, true
)
ON CONFLICT (code) DO UPDATE SET
  name               = EXCLUDED.name,
  affects_salary     = EXCLUDED.affects_salary,
  affects_transport  = EXCLUDED.affects_transport,
  active             = EXCLUDED.active;

-- 3. Índice para consultas por extra_data (útil en reportes)
CREATE INDEX IF NOT EXISTS idx_payroll_novelties_cambio_operativo
  ON payroll_novelties (novelty_type)
  WHERE novelty_type = 'CAMBIO_OPERATIVO_COBERTURA';
