-- 043: Nomina historica por cruce de rango laboral.
-- Migracion aditiva: no borra nomina ni novedades existentes.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS labor_start_date DATE,
  ADD COLUMN IF NOT EXISTS labor_end_date DATE,
  ADD COLUMN IF NOT EXISTS termination_reason TEXT,
  ADD COLUMN IF NOT EXISTS employment_status TEXT;

UPDATE employees
   SET labor_start_date = COALESCE(labor_start_date, start_date, coverage_start_date)
 WHERE labor_start_date IS NULL;

UPDATE employees
   SET employment_status = COALESCE(NULLIF(employment_status, ''), status)
 WHERE employment_status IS NULL OR employment_status = '';

ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_labor_dates_chk;

ALTER TABLE employees
  ADD CONSTRAINT employees_labor_dates_chk
  CHECK (labor_end_date IS NULL OR labor_start_date IS NULL OR labor_end_date >= labor_start_date);

ALTER TABLE payroll_items
  ADD COLUMN IF NOT EXISTS fecha_ingreso_aplicada DATE,
  ADD COLUMN IF NOT EXISTS fecha_retiro_aplicada DATE,
  ADD COLUMN IF NOT EXISTS dias_laborados_calculados INTEGER,
  ADD COLUMN IF NOT EXISTS dias_laborados_manual INTEGER,
  ADD COLUMN IF NOT EXISTS has_manual_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_fecha_retiro TEXT,
  ADD COLUMN IF NOT EXISTS payroll_inclusion_status TEXT;

CREATE INDEX IF NOT EXISTS idx_employees_labor_range
  ON employees(contract_id, labor_start_date, labor_end_date);

CREATE INDEX IF NOT EXISTS idx_payroll_nov_retiro_period_employee
  ON payroll_novelties(payroll_period_id, employee_id, novelty_type)
  WHERE novelty_type = 'FECHA_RETIRO';
