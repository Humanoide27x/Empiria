-- 048_employee_payroll_config.sql
-- Tabla de configuración salarial individual para empleados no-OPERARIO
-- (Gestores, Auxiliares, Equipo Mínimo, etc.).
-- Registra historial completo: se puede tener múltiples filas por empleado,
-- cada una con su fecha de vigencia. La nómina usa la más reciente <= period_start.

CREATE TABLE IF NOT EXISTS employee_payroll_config (
  id                  SERIAL PRIMARY KEY,
  employee_id         INTEGER NOT NULL,
  base_salary         NUMERIC NOT NULL DEFAULT 0,
  transport_allowance NUMERIC NOT NULL DEFAULT 0,
  salary_type         TEXT NOT NULL DEFAULT 'mensual'
                        CHECK (salary_type IN ('mensual','quincenal','semanal','jornal')),
  effective_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  notes               TEXT,
  created_by          INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para lookup por empleado ordenado por vigencia descendente
CREATE INDEX IF NOT EXISTS idx_epc_employee_date
  ON employee_payroll_config(employee_id, effective_date DESC);

-- Marcar que los grupos OPERARIO ya existentes son tipo MUNICIPAL (retrocompatibilidad)
UPDATE payroll_groups
   SET group_type = 'MUNICIPAL'
 WHERE group_type IS NULL OR group_type = '';
