ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS uniforme TEXT,
  ADD COLUMN IF NOT EXISTS calzado TEXT,
  ADD COLUMN IF NOT EXISTS talla_camisa TEXT,
  ADD COLUMN IF NOT EXISTS talla_pantalon TEXT;

ALTER TABLE employee_import_staging
  ADD COLUMN IF NOT EXISTS existing_employee_id INTEGER REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS conflicts JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employee_import_staging_status_check'
  ) THEN
    ALTER TABLE employee_import_staging
      DROP CONSTRAINT employee_import_staging_status_check;
  END IF;
END $$;

ALTER TABLE employee_import_staging
  ADD CONSTRAINT employee_import_staging_status_check
  CHECK (status IN (
    'PENDING',
    'VALID',
    'ERROR',
    'NEEDS_REVIEW',
    'EXISTING_EMPLOYEE',
    'HAS_CONFLICTS',
    'IMPORTED',
    'UPDATED',
    'SKIPPED'
  ));

CREATE INDEX IF NOT EXISTS employee_import_staging_existing_employee_idx
  ON employee_import_staging(existing_employee_id);
