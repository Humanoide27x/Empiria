-- 045_employee_retirement_date.sql
-- Agrega retirement_date a employees para sincronizar el retiro desde Nómina.
-- El campo es opcional (NULL = sin retiro registrado).

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS retirement_date DATE;

-- Índice parcial: solo las filas con fecha de retiro (minoría, coste mínimo)
CREATE INDEX IF NOT EXISTS idx_employees_retirement_date
  ON employees(retirement_date)
  WHERE retirement_date IS NOT NULL;
