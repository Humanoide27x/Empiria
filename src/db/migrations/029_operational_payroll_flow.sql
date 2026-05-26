-- Flujo operativo de nomina por cargo real, municipio, novedades y soportes.
-- Migracion aditiva: no reemplaza payroll_results ni la nomina legacy.

CREATE TABLE IF NOT EXISTS payroll_groups (
  id                   SERIAL PRIMARY KEY,
  period_id            INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  company_id           INTEGER,
  contract_id          INTEGER,
  municipality_id      INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  operational_position TEXT NOT NULL,
  group_type           TEXT NOT NULL DEFAULT 'MUNICIPAL',
  status               TEXT NOT NULL DEFAULT 'pendiente'
                         CHECK (status IN ('pendiente','en_revision','revisada','cerrada')),
  reviewed_by          INTEGER,
  reviewed_at          TIMESTAMPTZ,
  closed_by            INTEGER,
  closed_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_groups_uk
  ON payroll_groups (period_id, contract_id, COALESCE(municipality_id, 0), UPPER(BTRIM(operational_position)));

CREATE INDEX IF NOT EXISTS payroll_groups_period_idx ON payroll_groups(period_id);
CREATE INDEX IF NOT EXISTS payroll_groups_contract_idx ON payroll_groups(contract_id);
CREATE INDEX IF NOT EXISTS payroll_groups_municipality_idx ON payroll_groups(municipality_id);

CREATE TABLE IF NOT EXISTS payroll_items (
  id                   SERIAL PRIMARY KEY,
  group_id             INTEGER NOT NULL REFERENCES payroll_groups(id) ON DELETE CASCADE,
  period_id            INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id          BIGINT NOT NULL,
  employee_name        TEXT NOT NULL,
  document_number      TEXT,
  company_id           INTEGER,
  contract_id          INTEGER,
  municipality_id      INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  municipality_name    TEXT,
  institution_id       INTEGER,
  institution_name     TEXT,
  site_id              INTEGER,
  site_name            TEXT,
  modality             TEXT,
  operational_position TEXT,
  work_time_type       TEXT,
  base_salary          NUMERIC NOT NULL DEFAULT 0,
  transport_allowance  NUMERIC NOT NULL DEFAULT 0,
  other_earnings       NUMERIC NOT NULL DEFAULT 0,
  total_devengado      NUMERIC NOT NULL DEFAULT 0,
  total_deducciones    NUMERIC NOT NULL DEFAULT 0,
  neto_pagar           NUMERIC NOT NULL DEFAULT 0,
  calculation          JSONB NOT NULL DEFAULT '{}',
  payroll_status       TEXT NOT NULL DEFAULT 'pendiente',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_items_group_employee_uk
  ON payroll_items (group_id, employee_id);

CREATE INDEX IF NOT EXISTS payroll_items_period_idx ON payroll_items(period_id);
CREATE INDEX IF NOT EXISTS payroll_items_employee_idx ON payroll_items(employee_id);
CREATE INDEX IF NOT EXISTS payroll_items_assignment_idx
  ON payroll_items(contract_id, municipality_id, institution_id, site_id);

ALTER TABLE payroll_novelties
  ADD COLUMN IF NOT EXISTS payroll_period_id INTEGER REFERENCES payroll_periods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payroll_item_id INTEGER REFERENCES payroll_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS institution_id INTEGER,
  ADD COLUMN IF NOT EXISTS site_id INTEGER,
  ADD COLUMN IF NOT EXISTS operational_position TEXT,
  ADD COLUMN IF NOT EXISTS value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS reviewed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_by INTEGER,
  ADD COLUMN IF NOT EXISTS support_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS support_status TEXT NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS cover_type TEXT;

CREATE INDEX IF NOT EXISTS payroll_novelties_period_item_idx
  ON payroll_novelties(payroll_period_id, payroll_item_id);

CREATE INDEX IF NOT EXISTS payroll_novelties_reviewed_idx
  ON payroll_novelties(reviewed);

CREATE TABLE IF NOT EXISTS external_turn_workers (
  id              SERIAL PRIMARY KEY,
  full_name       TEXT NOT NULL,
  document_number TEXT NOT NULL,
  phone           TEXT,
  bank            TEXT,
  account_number  TEXT,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  site_id         INTEGER REFERENCES educational_sites(id) ON DELETE SET NULL,
  modality        TEXT,
  value_day       NUMERIC NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS external_turn_workers_document_uk
  ON external_turn_workers (document_number);

CREATE TABLE IF NOT EXISTS payroll_turn_covers (
  id                   SERIAL PRIMARY KEY,
  novelty_id            INTEGER NOT NULL REFERENCES payroll_novelties(id) ON DELETE CASCADE,
  payroll_item_id       INTEGER REFERENCES payroll_items(id) ON DELETE SET NULL,
  payroll_period_id     INTEGER REFERENCES payroll_periods(id) ON DELETE SET NULL,
  cover_type            TEXT NOT NULL CHECK (cover_type IN ('INTERNA','EXTERNA')),
  internal_employee_id  BIGINT,
  external_worker_id    INTEGER REFERENCES external_turn_workers(id) ON DELETE SET NULL,
  days                  NUMERIC NOT NULL DEFAULT 1,
  value_per_day         NUMERIC NOT NULL DEFAULT 0,
  total_value           NUMERIC NOT NULL DEFAULT 0,
  created_by            INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_turn_covers_novelty_uk
  ON payroll_turn_covers(novelty_id);

CREATE TABLE IF NOT EXISTS novelty_supports (
  id                   SERIAL PRIMARY KEY,
  novelty_id            INTEGER REFERENCES payroll_novelties(id) ON DELETE CASCADE,
  employee_id           BIGINT,
  payroll_period_id     INTEGER REFERENCES payroll_periods(id) ON DELETE SET NULL,
  municipality_id       INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  support_type          TEXT NOT NULL,
  required              BOOLEAN NOT NULL DEFAULT true,
  status                TEXT NOT NULL DEFAULT 'pendiente'
                          CHECK (status IN ('pendiente','cargado','aprobado','rechazado')),
  file_url              TEXT,
  file_name             TEXT,
  observations          TEXT,
  uploaded_by           INTEGER,
  uploaded_at           TIMESTAMPTZ,
  reviewed_by           INTEGER,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS novelty_supports_status_idx ON novelty_supports(status);
CREATE INDEX IF NOT EXISTS novelty_supports_period_idx ON novelty_supports(payroll_period_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  user_id     INTEGER,
  user_name   TEXT,
  reason      TEXT,
  payload     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS user_id INTEGER,
  ADD COLUMN IF NOT EXISTS user_name TEXT,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
