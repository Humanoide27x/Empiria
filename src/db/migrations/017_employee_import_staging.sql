CREATE TABLE IF NOT EXISTS import_aliases (
  id           SERIAL PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('municipality','manager','contract','company','position')),
  source_value TEXT NOT NULL,
  target_id    INTEGER,
  target_label TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (type, source_value)
);

CREATE INDEX IF NOT EXISTS import_aliases_type_source_idx
  ON import_aliases(type, source_value)
  WHERE active = true;

DROP TRIGGER IF EXISTS import_aliases_updated_at ON import_aliases;
CREATE TRIGGER import_aliases_updated_at
  BEFORE UPDATE ON import_aliases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS employee_import_staging (
  id                   SERIAL PRIMARY KEY,
  import_batch_id      UUID NOT NULL,
  row_number           INTEGER NOT NULL,
  document_number      TEXT,
  full_name            TEXT,
  municipality_text    TEXT,
  manager_text         TEXT,
  contract_text        TEXT,
  company_text         TEXT,
  real_position_text   TEXT,
  raw_data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status               TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','VALID','ERROR','NEEDS_REVIEW','IMPORTED')),
  errors               JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolved_municipality_id INTEGER REFERENCES municipalities(id),
  resolved_manager_id      INTEGER REFERENCES employees(id),
  resolved_manager_label   TEXT,
  resolved_contract_id     INTEGER REFERENCES contracts(id),
  resolved_company_id      INTEGER REFERENCES companies(id),
  resolved_position_id     INTEGER REFERENCES positions(id),
  resolved_position_label  TEXT,
  created_by           INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_import_staging_batch_idx
  ON employee_import_staging(import_batch_id);

CREATE INDEX IF NOT EXISTS employee_import_staging_batch_status_idx
  ON employee_import_staging(import_batch_id, status);

CREATE INDEX IF NOT EXISTS employee_import_staging_document_idx
  ON employee_import_staging(document_number);

DROP TRIGGER IF EXISTS employee_import_staging_updated_at ON employee_import_staging;
CREATE TRIGGER employee_import_staging_updated_at
  BEFORE UPDATE ON employee_import_staging
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
