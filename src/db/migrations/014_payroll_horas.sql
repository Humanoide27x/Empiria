-- Soporte para nóminas por horas (bodega RI, bodega RP, administrativos)
ALTER TABLE payroll_results
  ADD COLUMN IF NOT EXISTS horas_diarias  JSONB       NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS payroll_type   VARCHAR(20) NOT NULL DEFAULT 'mensual';
