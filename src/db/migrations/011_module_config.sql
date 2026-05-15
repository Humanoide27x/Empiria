-- Configuración de widgets del Dashboard por contrato
CREATE TABLE IF NOT EXISTS dashboard_config (
  id          SERIAL      PRIMARY KEY,
  contract_id INTEGER     UNIQUE NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  widgets     JSONB       NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Configuración de campos por módulo por contrato
CREATE TABLE IF NOT EXISTS modulo_campos_config (
  id          SERIAL      PRIMARY KEY,
  contract_id INTEGER     NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  modulo_slug TEXT        NOT NULL,
  campos      JSONB       NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contract_id, modulo_slug)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_config_contract  ON dashboard_config(contract_id);
CREATE INDEX IF NOT EXISTS idx_modulo_campos_contract_mod ON modulo_campos_config(contract_id, modulo_slug);
