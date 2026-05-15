-- =================================================================
-- EMPIRIA V1 — Alteraciones sobre schema existente
-- Ejecutar UNA sola vez contra empiria_db
-- =================================================================

-- 1. employees: columna para preservar el ID legacy del JSON (timestamp bigint)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS legacy_json_id BIGINT UNIQUE;

-- 2. employees: columna cargo que falta (real_position ya existe, pero se usa cargo en el código)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS cargo TEXT;

-- 3. employees: food handling (documentos PAE)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS food_handling_course_issue_date     DATE,
  ADD COLUMN IF NOT EXISTS food_handling_course_expiry_date    DATE,
  ADD COLUMN IF NOT EXISTS food_handling_exam_issue_date       DATE,
  ADD COLUMN IF NOT EXISTS food_handling_exam_expiry_date      DATE;

-- 4. employees: residencia y gestor zona
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS gestor_zona       TEXT,
  ADD COLUMN IF NOT EXISTS civil_status_text TEXT;

-- 5. Añadir roles faltantes (gestores_auxiliares e interventoria)
INSERT INTO roles (code, name, active) VALUES
  ('GESTORES_AUXILIARES', 'Gestores / Auxiliares', true),
  ('INTERVENTORIA',       'Interventoría',          true)
ON CONFLICT (code) DO NOTHING;

-- 6. municipalities: añadir alias para búsqueda normalizada
ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS search_alias TEXT;

-- Poblar alias (nombre lowercase sin tilde para búsqueda fuzzy)
UPDATE municipalities SET search_alias = LOWER(
  TRANSLATE(name,
    'ÁÉÍÓÚáéíóúÑñÜü',
    'AEIOUaeiouNnUu'
  )
) WHERE search_alias IS NULL;

-- 7. users: columna para rol string legacy (ayuda al mapeo inicial)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role_code TEXT;

-- 8. payroll_novelties: índice para búsquedas por employee y periodo
CREATE INDEX IF NOT EXISTS idx_payroll_nov_employee ON payroll_novelties(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_nov_company  ON payroll_novelties(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_nov_status   ON payroll_novelties(status);

-- 9. employees: índices para búsquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_employees_company    ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_contract   ON employees(contract_id);
CREATE INDEX IF NOT EXISTS idx_employees_municipality ON employees(municipality_id);
CREATE INDEX IF NOT EXISTS idx_employees_status     ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_legacy_id  ON employees(legacy_json_id);
CREATE INDEX IF NOT EXISTS idx_employees_doc        ON employees(document_type, document_number);

-- 10. users: índice username
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_company         ON users(company_id);
