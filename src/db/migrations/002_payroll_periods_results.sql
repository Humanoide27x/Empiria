-- Períodos de nómina (inmutables una vez cerrados)
CREATE TABLE IF NOT EXISTS payroll_periods (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL,
  contract_id  INTEGER,
  period_start DATE    NOT NULL,
  period_end   DATE    NOT NULL,
  label        TEXT    NOT NULL,        -- Ej: "Mayo 2026 - Contrato 1"
  status       TEXT    NOT NULL DEFAULT 'BORRADOR'
                        CHECK (status IN ('BORRADOR','CALCULADO','CERRADO')),
  closed_by    INTEGER,                 -- user_id
  closed_at    TIMESTAMPTZ,
  created_by   INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payroll_periods_uniq UNIQUE (company_id, contract_id, period_start)
);

-- Líneas de resultado de nómina (inmutables — snapshot del cálculo)
CREATE TABLE IF NOT EXISTS payroll_results (
  id                SERIAL PRIMARY KEY,
  period_id         INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id       BIGINT  NOT NULL,   -- legacy_json_id
  employee_name     TEXT    NOT NULL,
  document_number   TEXT    NOT NULL,
  company_id        INTEGER NOT NULL,
  contract_id       INTEGER,
  municipality      TEXT,
  institution       TEXT,
  site              TEXT,
  modality          TEXT,
  modality_class    TEXT,
  work_time_type    TEXT,
  worked_days       NUMERIC NOT NULL DEFAULT 30,
  base_salary       NUMERIC NOT NULL DEFAULT 0,
  transport_allowance NUMERIC NOT NULL DEFAULT 0,
  other_earnings    NUMERIC NOT NULL DEFAULT 0,
  total_devengado   NUMERIC NOT NULL DEFAULT 0,
  deduccion_salud   NUMERIC NOT NULL DEFAULT 0,
  deduccion_pension NUMERIC NOT NULL DEFAULT 0,
  total_deducciones NUMERIC NOT NULL DEFAULT 0,
  novedad_descuento NUMERIC NOT NULL DEFAULT 0,
  neto_pagar        NUMERIC NOT NULL DEFAULT 0,
  observations      TEXT,
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payroll_results_period_idx ON payroll_results(period_id);
CREATE INDEX IF NOT EXISTS payroll_results_employee_idx ON payroll_results(employee_id);
