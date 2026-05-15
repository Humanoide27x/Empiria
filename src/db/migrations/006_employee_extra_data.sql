-- Agrega columnas JSONB para experiencia laboral y estudios del empleado
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS work_experience JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS studies         JSONB NOT NULL DEFAULT '[]';
