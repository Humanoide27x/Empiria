ALTER TABLE contract_settings
  ADD COLUMN IF NOT EXISTS role_permissions JSONB NOT NULL DEFAULT '{}';
