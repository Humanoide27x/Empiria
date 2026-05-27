-- 036: Revisión completa del registro de nómina por empleado (payroll_items)
-- Permite marcar el registro completo de un empleado como revisado,
-- bloqueando toda edición adicional mientras esté marcado.

ALTER TABLE payroll_items
  ADD COLUMN IF NOT EXISTS reviewed     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_by  INTEGER     NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at  TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS payroll_items_reviewed_idx ON payroll_items(reviewed);
