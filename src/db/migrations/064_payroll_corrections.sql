-- Migration 064: Tabla de correcciones de nómina
-- Trazabilidad de diferencias detectadas post-cálculo.
-- Solo registra — no modifica ningún dato de payroll_results.

CREATE TABLE IF NOT EXISTS payroll_corrections (
  id              SERIAL PRIMARY KEY,
  period_id       INTEGER REFERENCES payroll_periods(id) ON DELETE SET NULL,
  employee_id     TEXT    NOT NULL,
  employee_name   TEXT    NOT NULL,
  tipo            TEXT    NOT NULL
                    CHECK (tipo IN ('salario','descuento','novedad','diferencia_dias','otro')),
  concepto        TEXT    NOT NULL,
  valor_calculado NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_correcto  NUMERIC(14,2) NOT NULL DEFAULT 0,
  diferencia      NUMERIC(14,2) GENERATED ALWAYS AS (valor_correcto - valor_calculado) STORED,
  impacto         TEXT    NOT NULL DEFAULT 'sin_impacto'
                    CHECK (impacto IN ('a_favor_empleado','a_favor_empresa','sin_impacto')),
  estado          TEXT    NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','en_revision','aprobada','aplicada','rechazada')),
  observaciones   TEXT,
  como_se_resolvio TEXT,
  created_by      INTEGER,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      INTEGER,
  updated_by_name TEXT
);

CREATE INDEX IF NOT EXISTS payroll_corrections_period_idx   ON payroll_corrections(period_id);
CREATE INDEX IF NOT EXISTS payroll_corrections_employee_idx ON payroll_corrections(employee_id);
CREATE INDEX IF NOT EXISTS payroll_corrections_estado_idx   ON payroll_corrections(estado);
