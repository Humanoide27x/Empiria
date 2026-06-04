-- 057: Metadatos para carga masiva documental de personal

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS original_file_name TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

UPDATE employee_documents
SET original_file_name = COALESCE(NULLIF(original_file_name, ''), file_name)
WHERE COALESCE(original_file_name, '') = '';

UPDATE employee_documents
SET version = COALESCE(version, 1)
WHERE version IS NULL OR version < 1;

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_type_version
  ON employee_documents (employee_id, document_type_id, version DESC, uploaded_at DESC, id DESC);

COMMENT ON COLUMN employee_documents.original_file_name IS
  'Nombre original suministrado por el usuario antes de normalizar el almacenamiento.';

COMMENT ON COLUMN employee_documents.uploaded_by IS
  'Usuario responsable de la carga del documento.';

COMMENT ON COLUMN employee_documents.version IS
  'Version logica del documento por empleado y tipo documental.';
