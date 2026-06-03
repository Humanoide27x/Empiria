-- =============================================================================
-- EMPIRIA 058 — Historial estable de sedes para cobertura
-- Regla: la identidad operativa vive en site_id / institution_id internos.
-- El código oficial y la modalidad se versionan por vigencia.
-- =============================================================================

CREATE TABLE IF NOT EXISTS site_code_history (
  id           SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES educational_sites(id) ON DELETE CASCADE,
  official_code TEXT NOT NULL,
  valid_from    DATE NOT NULL,
  valid_to      DATE,
  source        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    TEXT
);

ALTER TABLE site_code_history
  ADD COLUMN IF NOT EXISTS site_id       INTEGER,
  ADD COLUMN IF NOT EXISTS official_code TEXT,
  ADD COLUMN IF NOT EXISTS valid_from    DATE,
  ADD COLUMN IF NOT EXISTS valid_to      DATE,
  ADD COLUMN IF NOT EXISTS source        TEXT,
  ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_by    TEXT;

UPDATE site_code_history
SET
  official_code = BTRIM(official_code),
  created_at = COALESCE(created_at, NOW()),
  valid_from = COALESCE(valid_from, CURRENT_DATE)
WHERE official_code IS NOT NULL;

ALTER TABLE site_code_history
  ALTER COLUMN site_id SET NOT NULL,
  ALTER COLUMN official_code SET NOT NULL,
  ALTER COLUMN valid_from SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE site_code_history
  DROP CONSTRAINT IF EXISTS site_code_history_valid_range_ck;

ALTER TABLE site_code_history
  ADD CONSTRAINT site_code_history_valid_range_ck
    CHECK (valid_to IS NULL OR valid_to >= valid_from);

CREATE INDEX IF NOT EXISTS idx_site_code_history_site_period
  ON site_code_history (site_id, valid_from DESC, valid_to);

CREATE INDEX IF NOT EXISTS idx_site_code_history_official_code
  ON site_code_history (UPPER(BTRIM(official_code)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_code_history_site_open
  ON site_code_history (site_id)
  WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS site_modality_history (
  id          SERIAL PRIMARY KEY,
  site_id      INTEGER NOT NULL REFERENCES educational_sites(id) ON DELETE CASCADE,
  modality     TEXT NOT NULL,
  valid_from   DATE NOT NULL,
  valid_to     DATE,
  source       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   TEXT
);

ALTER TABLE site_modality_history
  ADD COLUMN IF NOT EXISTS site_id     INTEGER,
  ADD COLUMN IF NOT EXISTS modality    TEXT,
  ADD COLUMN IF NOT EXISTS valid_from  DATE,
  ADD COLUMN IF NOT EXISTS valid_to    DATE,
  ADD COLUMN IF NOT EXISTS source      TEXT,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_by  TEXT;

UPDATE site_modality_history
SET
  modality = BTRIM(modality),
  created_at = COALESCE(created_at, NOW()),
  valid_from = COALESCE(valid_from, CURRENT_DATE)
WHERE modality IS NOT NULL;

ALTER TABLE site_modality_history
  ALTER COLUMN site_id SET NOT NULL,
  ALTER COLUMN modality SET NOT NULL,
  ALTER COLUMN valid_from SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE site_modality_history
  DROP CONSTRAINT IF EXISTS site_modality_history_valid_range_ck;

ALTER TABLE site_modality_history
  ADD CONSTRAINT site_modality_history_valid_range_ck
    CHECK (valid_to IS NULL OR valid_to >= valid_from);

CREATE INDEX IF NOT EXISTS idx_site_modality_history_site_period
  ON site_modality_history (site_id, valid_from DESC, valid_to);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_modality_history_site_open
  ON site_modality_history (site_id)
  WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS coverage_change_audit (
  id                    SERIAL PRIMARY KEY,
  session_token         TEXT,
  upload_id             INTEGER REFERENCES coverage_uploads(id) ON DELETE SET NULL,
  company_id            INTEGER,
  contract_id           INTEGER,
  period_month          TEXT,
  municipality_id       INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  institution_id        INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  site_id               INTEGER REFERENCES educational_sites(id) ON DELETE SET NULL,
  municipality_name     TEXT,
  institution_name      TEXT,
  site_name             TEXT,
  previous_official_code TEXT,
  new_official_code      TEXT,
  previous_modality      TEXT,
  new_modality           TEXT,
  effective_date        DATE,
  confirmed_by          TEXT,
  source_file_name      TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  change_type           TEXT NOT NULL,
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at          TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE coverage_change_audit
  ADD COLUMN IF NOT EXISTS session_token          TEXT,
  ADD COLUMN IF NOT EXISTS upload_id              INTEGER REFERENCES coverage_uploads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id             INTEGER,
  ADD COLUMN IF NOT EXISTS contract_id            INTEGER,
  ADD COLUMN IF NOT EXISTS period_month           TEXT,
  ADD COLUMN IF NOT EXISTS municipality_id        INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS institution_id         INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_id                INTEGER REFERENCES educational_sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS municipality_name      TEXT,
  ADD COLUMN IF NOT EXISTS institution_name       TEXT,
  ADD COLUMN IF NOT EXISTS site_name              TEXT,
  ADD COLUMN IF NOT EXISTS previous_official_code TEXT,
  ADD COLUMN IF NOT EXISTS new_official_code      TEXT,
  ADD COLUMN IF NOT EXISTS previous_modality      TEXT,
  ADD COLUMN IF NOT EXISTS new_modality           TEXT,
  ADD COLUMN IF NOT EXISTS effective_date         DATE,
  ADD COLUMN IF NOT EXISTS confirmed_by           TEXT,
  ADD COLUMN IF NOT EXISTS source_file_name       TEXT,
  ADD COLUMN IF NOT EXISTS status                 TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS change_type            TEXT,
  ADD COLUMN IF NOT EXISTS detected_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS confirmed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata               JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE coverage_change_audit
SET
  status = COALESCE(NULLIF(BTRIM(status), ''), 'pending'),
  detected_at = COALESCE(detected_at, NOW()),
  metadata = COALESCE(metadata, '{}'::jsonb);

ALTER TABLE coverage_change_audit
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN change_type SET NOT NULL,
  ALTER COLUMN detected_at SET NOT NULL,
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN metadata SET NOT NULL;

ALTER TABLE coverage_change_audit
  DROP CONSTRAINT IF EXISTS coverage_change_audit_status_ck,
  DROP CONSTRAINT IF EXISTS coverage_change_audit_type_ck;

ALTER TABLE coverage_change_audit
  ADD CONSTRAINT coverage_change_audit_status_ck
    CHECK (status IN ('pending', 'confirmed', 'rejected')),
  ADD CONSTRAINT coverage_change_audit_type_ck
    CHECK (change_type IN ('SITE_CODE', 'MODALITY'));

CREATE INDEX IF NOT EXISTS idx_coverage_change_audit_scope
  ON coverage_change_audit (company_id, contract_id, period_month, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_coverage_change_audit_status
  ON coverage_change_audit (status, detected_at DESC);

ALTER TABLE coverage_upload_rows
  ADD COLUMN IF NOT EXISTS institution_id   INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_id          INTEGER REFERENCES educational_sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS official_code    TEXT,
  ADD COLUMN IF NOT EXISTS resolution_source TEXT;

UPDATE coverage_upload_rows
SET official_code = COALESCE(NULLIF(BTRIM(official_code), ''), NULLIF(BTRIM(unique_code), ''))
WHERE official_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_coverage_upload_rows_site_period
  ON coverage_upload_rows (upload_id, municipality_id, institution_id, site_id);

CREATE INDEX IF NOT EXISTS idx_coverage_upload_rows_official_code
  ON coverage_upload_rows (UPPER(BTRIM(COALESCE(official_code, unique_code))));
