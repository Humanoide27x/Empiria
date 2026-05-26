-- 017_performance_indexes.sql
-- Índices de rendimiento para consultas frecuentes del dashboard y personal

-- coverage_uploads: ORDER BY created_at DESC (usado en SELECT id ... ORDER BY created_at DESC LIMIT 1)
CREATE INDEX IF NOT EXISTS idx_coverage_uploads_created_at
  ON coverage_uploads (created_at DESC);

-- coverage_upload_rows: WHERE upload_id = $1 (JOIN principal en todas las consultas de cobertura)
CREATE INDEX IF NOT EXISTS idx_coverage_upload_rows_upload_id
  ON coverage_upload_rows (upload_id);

-- employees: filtros de estado (WHERE UPPER(TRIM(status)) = 'ACTIVO')
CREATE INDEX IF NOT EXISTS idx_employees_status
  ON employees (UPPER(TRIM(status)));

-- employees: scoping por empresa + estado (patrón muy frecuente en dashboard)
CREATE INDEX IF NOT EXISTS idx_employees_company_status
  ON employees (company_id, UPPER(TRIM(status)));

-- employees: food_handling_exam_expiry_date (usado en alertas de certificados vencidos)
CREATE INDEX IF NOT EXISTS idx_employees_food_exam_expiry
  ON employees (food_handling_exam_expiry_date)
  WHERE food_handling_exam_expiry_date IS NOT NULL;

-- employees: updated_at (usado en ORDER BY GREATEST(created_at, updated_at) en actividad reciente)
CREATE INDEX IF NOT EXISTS idx_employees_updated_at
  ON employees (updated_at DESC);

-- employees: municipality_id (JOIN frecuente con municipalities)
CREATE INDEX IF NOT EXISTS idx_employees_municipality_id
  ON employees (municipality_id);
