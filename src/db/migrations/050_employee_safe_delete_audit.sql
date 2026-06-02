-- 050: Tabla de auditoría para eliminación/inactivación segura de empleados
CREATE TABLE IF NOT EXISTS employee_deletion_audit (
  id                 SERIAL PRIMARY KEY,
  employee_id        INTEGER,
  employee_name      TEXT,
  document_number    TEXT,
  action_type        TEXT NOT NULL CHECK (action_type IN ('INACTIVACION','ELIMINACION_DEFINITIVA','INTENTO_FALLIDO')),
  performed_by_id    INTEGER,
  performed_by_name  TEXT,
  ip                 TEXT,
  user_agent         TEXT,
  company_id         INTEGER,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emp_del_audit_emp_id   ON employee_deletion_audit(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_del_audit_created  ON employee_deletion_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_emp_del_audit_action   ON employee_deletion_audit(action_type);
