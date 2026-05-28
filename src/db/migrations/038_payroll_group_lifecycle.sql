-- Migration 038: ERP lifecycle for payroll groups
-- Adds versioning, snapshots, reopen audit, and canonical status states

BEGIN;

-- ── 1. Migrate & extend payroll_groups status ────────────────────────────────
ALTER TABLE payroll_groups DROP CONSTRAINT IF EXISTS payroll_groups_status_check;

UPDATE payroll_groups SET status = 'CLOSED'    WHERE status = 'cerrada';
UPDATE payroll_groups SET status = 'IN_REVIEW' WHERE status IN ('pendiente','en_revision','revisada');

ALTER TABLE payroll_groups
  ADD CONSTRAINT payroll_groups_status_check
  CHECK (status IN ('DRAFT','IN_REVIEW','CLOSED','REOPENED','SENT','PAID'));

ALTER TABLE payroll_groups ALTER COLUMN status SET DEFAULT 'IN_REVIEW';

-- ── 2. Lifecycle columns ─────────────────────────────────────────────────────
ALTER TABLE payroll_groups
  ADD COLUMN IF NOT EXISTS version_number      INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS needs_recalculation BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reopen_reason       TEXT,
  ADD COLUMN IF NOT EXISTS reopened_by         INTEGER,
  ADD COLUMN IF NOT EXISTS reopened_at         TIMESTAMPTZ;

-- ── 3. Snapshots (one per close event, never overwritten) ────────────────────
CREATE TABLE IF NOT EXISTS payroll_group_snapshots (
  id             SERIAL PRIMARY KEY,
  group_id       INTEGER NOT NULL REFERENCES payroll_groups(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  closed_by      INTEGER,
  closed_by_name TEXT,
  closed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_data  JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pg_snapshots_group_idx ON payroll_group_snapshots(group_id);
CREATE UNIQUE INDEX IF NOT EXISTS pg_snapshots_group_version_uk ON payroll_group_snapshots(group_id, version_number);

-- ── 4. Reopen audit log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_reopen_logs (
  id               SERIAL PRIMARY KEY,
  payroll_group_id INTEGER NOT NULL REFERENCES payroll_groups(id) ON DELETE CASCADE,
  municipality_id  INTEGER,
  period_id        INTEGER,
  previous_status  TEXT NOT NULL,
  new_status       TEXT NOT NULL,
  reason           TEXT NOT NULL,
  observations     TEXT,
  reopened_by      INTEGER,
  reopened_by_name TEXT,
  reopened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by        INTEGER,
  closed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pg_reopen_logs_group_idx ON payroll_reopen_logs(payroll_group_id);

COMMIT;
