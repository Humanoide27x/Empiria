-- 047_payroll_municipality_status_add_id.sql
-- Agrega municipality_id (FK numérica) a payroll_municipality_status para
-- evitar la confusión entre municipios con nombres similares (ej. Granada / El Castillo).
-- El JOIN en listPayrollGroups usará la FK primero y solo recurrirá al nombre
-- como fallback para filas históricas sin id.

ALTER TABLE payroll_municipality_status
  ADD COLUMN IF NOT EXISTS municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL;

-- Backfill: asignar municipality_id por coincidencia de nombre (case-insensitive, trim)
UPDATE payroll_municipality_status pms
   SET municipality_id = m.id
  FROM municipalities m
 WHERE LOWER(TRIM(m.name)) = LOWER(TRIM(pms.municipality))
   AND pms.municipality_id IS NULL;

-- Índice para el JOIN eficiente
CREATE INDEX IF NOT EXISTS idx_pms_period_muni_id
  ON payroll_municipality_status(period_id, municipality_id)
  WHERE municipality_id IS NOT NULL;

-- Índice único por ID — las nuevas inserciones usan este constraint
CREATE UNIQUE INDEX IF NOT EXISTS pms_period_muni_id_uk
  ON payroll_municipality_status(period_id, municipality_id)
  WHERE municipality_id IS NOT NULL;
