-- Columnas adicionales para nómina PAE en payroll_results
ALTER TABLE payroll_results
  ADD COLUMN IF NOT EXISTS dias_no_clase       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS novedades_detalle   JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS adicionales_detalle JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS salary_snapshot     JSONB   NOT NULL DEFAULT '{}';
