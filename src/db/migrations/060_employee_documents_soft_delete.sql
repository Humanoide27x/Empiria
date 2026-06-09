ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS original_filename text,
  ADD COLUMN IF NOT EXISTS stored_filename text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS size_bytes bigint,
  ADD COLUMN IF NOT EXISTS replaced_by_document_id bigint,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE employee_documents
  ADD CONSTRAINT employee_documents_replaced_by_fk
  FOREIGN KEY (replaced_by_document_id) REFERENCES employee_documents(id) ON DELETE SET NULL;
