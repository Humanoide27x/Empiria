-- Soporte para jerarquía de clientes: una empresa puede tener sub-empresas
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS parent_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_companies_parent ON companies(parent_company_id);
