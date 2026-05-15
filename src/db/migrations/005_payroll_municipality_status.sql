-- Tracks which municipalities have marked their novedades as complete for a payroll period
CREATE TABLE IF NOT EXISTS payroll_municipality_status (
  id          SERIAL      PRIMARY KEY,
  period_id   INTEGER     NOT NULL,
  municipality TEXT        NOT NULL,
  is_complete BOOLEAN     NOT NULL DEFAULT FALSE,
  completed_by_user_id INTEGER,
  completed_by_name TEXT,
  completed_at TIMESTAMPTZ,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id, municipality)
);

CREATE INDEX IF NOT EXISTS pms_period_idx ON payroll_municipality_status(period_id);
CREATE INDEX IF NOT EXISTS pms_complete_idx ON payroll_municipality_status(period_id, is_complete);
