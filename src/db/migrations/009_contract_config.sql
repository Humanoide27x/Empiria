-- Contract-level settings: enabled modules, position mode, and positions list (JSONB)
CREATE TABLE IF NOT EXISTS contract_settings (
  contract_id   INTEGER     PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
  position_mode VARCHAR(20) NOT NULL DEFAULT 'licitacion',
  modules       JSONB       NOT NULL DEFAULT '{}',
  positions     JSONB       NOT NULL DEFAULT '[]',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
