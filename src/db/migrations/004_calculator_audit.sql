-- 004: Calculadora de personal — tabla de auditoría
CREATE TABLE IF NOT EXISTS calculator_audit (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER,
  username      TEXT NOT NULL,
  user_role     TEXT,
  modality      TEXT NOT NULL CHECK (modality IN ('CAA', 'CAARES', 'RI')),
  cupos         INTEGER NOT NULL CHECK (cupos >= 0),
  raw_result    NUMERIC(10, 4),
  full_time     INTEGER NOT NULL DEFAULT 0,
  half_time     INTEGER NOT NULL DEFAULT 0,
  ip_address    TEXT,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS calculator_audit_user_idx     ON calculator_audit(user_id);
CREATE INDEX IF NOT EXISTS calculator_audit_date_idx     ON calculator_audit(calculated_at DESC);
CREATE INDEX IF NOT EXISTS calculator_audit_modality_idx ON calculator_audit(modality);
