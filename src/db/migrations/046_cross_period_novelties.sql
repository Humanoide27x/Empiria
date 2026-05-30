-- 046_cross_period_novelties.sql
-- Soporte para novedades que abarcan múltiples períodos de nómina.
-- Una novedad se guarda una sola vez; el sistema distribuye los días
-- automáticamente entre los períodos afectados al calcular.

ALTER TABLE payroll_novelties
  ADD COLUMN IF NOT EXISTS original_start_date DATE,
  ADD COLUMN IF NOT EXISTS original_end_date   DATE,
  ADD COLUMN IF NOT EXISTS parent_novelty_id   INTEGER
    REFERENCES payroll_novelties(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_continuation     BOOLEAN NOT NULL DEFAULT false;

-- FK para la relación padre→hijo
CREATE INDEX IF NOT EXISTS idx_payroll_novelties_parent_id
  ON payroll_novelties(parent_novelty_id)
  WHERE parent_novelty_id IS NOT NULL;

-- Búsqueda de novedades que se extienden más allá del período actual
CREATE INDEX IF NOT EXISTS idx_payroll_novelties_original_end
  ON payroll_novelties(original_end_date)
  WHERE original_end_date IS NOT NULL;
