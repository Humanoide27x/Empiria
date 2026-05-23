ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS account_type         TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_name            TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS account_number       TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS auxiliar_gestor_zona TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS contract_type        TEXT DEFAULT '';
