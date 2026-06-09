-- 059: Centro de Documentos - carga masiva, lote y versionado documental

CREATE TABLE IF NOT EXISTS document_upload_batches (
  id              BIGSERIAL PRIMARY KEY,
  batch_name      TEXT NOT NULL,
  document_type   TEXT,
  upload_mode     TEXT NOT NULL,
  total_files     INTEGER NOT NULL DEFAULT 0,
  ready_count     INTEGER NOT NULL DEFAULT 0,
  not_found_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'PREVIEWED',
  summary_json    JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_document_upload_batches_created_at
  ON document_upload_batches (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_document_upload_batches_status
  ON document_upload_batches (status, created_at DESC);

CREATE TABLE IF NOT EXISTS document_upload_batch_items (
  id                       BIGSERIAL PRIMARY KEY,
  batch_id                 BIGINT NOT NULL REFERENCES document_upload_batches(id) ON DELETE CASCADE,
  original_filename        TEXT NOT NULL,
  stored_filename          TEXT,
  detected_document_number  TEXT,
  employee_id              INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  employee_name            TEXT,
  document_type            TEXT,
  status                   TEXT NOT NULL,
  reason                   TEXT,
  action                   TEXT,
  employee_document_id     BIGINT REFERENCES employee_documents(id) ON DELETE SET NULL,
  temp_file_path           TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_upload_batch_items_batch_id
  ON document_upload_batch_items (batch_id, id);

CREATE INDEX IF NOT EXISTS idx_document_upload_batch_items_employee_id
  ON document_upload_batch_items (employee_id, document_type);

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS document_type TEXT,
  ADD COLUMN IF NOT EXISTS stored_filename TEXT,
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS checksum TEXT,
  ADD COLUMN IF NOT EXISTS replaced_document_id BIGINT,
  ADD COLUMN IF NOT EXISTS batch_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_type_version_active
  ON employee_documents (employee_id, document_type_id, version DESC, uploaded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_employee_documents_batch_id
  ON employee_documents (batch_id);

ALTER TABLE employee_documents
  DROP CONSTRAINT IF EXISTS employee_documents_replaced_document_id_fkey;

ALTER TABLE employee_documents
  ADD CONSTRAINT employee_documents_replaced_document_id_fkey
  FOREIGN KEY (replaced_document_id)
  REFERENCES employee_documents(id)
  ON DELETE SET NULL;

ALTER TABLE employee_documents
  DROP CONSTRAINT IF EXISTS employee_documents_batch_id_fkey;

ALTER TABLE employee_documents
  ADD CONSTRAINT employee_documents_batch_id_fkey
  FOREIGN KEY (batch_id)
  REFERENCES document_upload_batches(id)
  ON DELETE SET NULL;

WITH central_document_types(code, name, description, required, visible_to_auditor) AS (
  VALUES
    ('CEDULA_DE_CIUDADANIA', 'Cédula de ciudadanía', 'Documento de identificación principal.', true, true),
    ('HOJA_DE_VIDA', 'Hoja de vida', 'Hoja de vida actualizada del empleado.', true, true),
    ('CONTRATO_LABORAL', 'Contrato laboral', 'Contrato o soporte de vinculación.', true, true),
    ('AFILIACION_EPS', 'Afiliación EPS', 'Soporte de afiliación a EPS.', true, true),
    ('AFILIACION_PENSION', 'Afiliación pensión', 'Soporte de afiliación a pensión.', true, true),
    ('AFILIACION_ARL', 'Afiliación ARL', 'Soporte de afiliación a ARL.', true, true),
    ('CERTIFICADO_RESIDENCIA', 'Certificado de residencia', 'Certificado de residencia.', false, true),
    ('SISBEN', 'SISBEN', 'Registro o certificación SISBEN.', false, true),
    ('CURSO_MANIPULACION_ALIMENTOS', 'Curso manipulación alimentos', 'Certificado del curso de manipulación de alimentos.', true, true),
    ('EXAMEN_MANIPULACION_ALIMENTOS', 'Examen manipulación alimentos', 'Examen médico de manipulación de alimentos.', true, true),
    ('DIPLOMA', 'Diploma', 'Diploma académico.', false, true),
    ('ACTA_GRADO', 'Acta de grado', 'Acta de grado académica.', false, true),
    ('TARJETA_PROFESIONAL', 'Tarjeta profesional', 'Tarjeta profesional o matrícula.', false, true),
    ('CERTIFICACION_BANCARIA', 'Certificación bancaria', 'Certificación de cuenta bancaria.', false, true),
    ('AUTORIZACION_TRATAMIENTO_DATOS', 'Autorización tratamiento datos', 'Autorización de tratamiento de datos personales.', true, true),
    ('INDUCCION', 'Inducción', 'Evidencia de inducción.', false, true),
    ('DOTACION', 'Dotación', 'Soportes de entrega de dotación.', false, false),
    ('OTROS', 'Otros', 'Documento misceláneo.', false, false)
)
INSERT INTO master_document_types (
  code,
  name,
  description,
  phase,
  is_global_base,
  visible_to_auditor,
  active,
  default_expires,
  default_alert_days_before_expiration
)
SELECT
  cdt.code,
  cdt.name,
  cdt.description,
  'preingreso',
  true,
  cdt.visible_to_auditor,
  true,
  false,
  NULL
FROM central_document_types cdt
ON CONFLICT (name) DO UPDATE SET
  code = EXCLUDED.code,
  description = EXCLUDED.description,
  phase = EXCLUDED.phase,
  is_global_base = EXCLUDED.is_global_base,
  visible_to_auditor = EXCLUDED.visible_to_auditor,
  active = EXCLUDED.active,
  updated_at = NOW();

WITH central_document_types(code, name, required, visible_to_auditor) AS (
  VALUES
    ('CEDULA_DE_CIUDADANIA', 'Cédula de ciudadanía', true, true),
    ('HOJA_DE_VIDA', 'Hoja de vida', true, true),
    ('CONTRATO_LABORAL', 'Contrato laboral', true, true),
    ('AFILIACION_EPS', 'Afiliación EPS', true, true),
    ('AFILIACION_PENSION', 'Afiliación pensión', true, true),
    ('AFILIACION_ARL', 'Afiliación ARL', true, true),
    ('CERTIFICADO_RESIDENCIA', 'Certificado de residencia', false, true),
    ('SISBEN', 'SISBEN', false, true),
    ('CURSO_MANIPULACION_ALIMENTOS', 'Curso manipulación alimentos', true, true),
    ('EXAMEN_MANIPULACION_ALIMENTOS', 'Examen manipulación alimentos', true, true),
    ('DIPLOMA', 'Diploma', false, true),
    ('ACTA_GRADO', 'Acta de grado', false, true),
    ('TARJETA_PROFESIONAL', 'Tarjeta profesional', false, true),
    ('CERTIFICACION_BANCARIA', 'Certificación bancaria', false, true),
    ('AUTORIZACION_TRATAMIENTO_DATOS', 'Autorización tratamiento datos', true, true),
    ('INDUCCION', 'Inducción', false, true),
    ('DOTACION', 'Dotación', false, false),
    ('OTROS', 'Otros', false, false)
)
INSERT INTO document_types (
  code,
  name,
  phase,
  required,
  visible_to_auditor,
  active,
  master_document_type_id
)
SELECT
  cdt.code,
  cdt.name,
  'preingreso',
  cdt.required,
  cdt.visible_to_auditor,
  true,
  mdt.id
FROM central_document_types cdt
JOIN master_document_types mdt
  ON UPPER(BTRIM(mdt.code)) = cdt.code
WHERE NOT EXISTS (
  SELECT 1
  FROM document_types dt
  WHERE UPPER(BTRIM(dt.code)) = cdt.code
);

COMMENT ON TABLE document_upload_batches IS
  'Lotes de carga masiva documental del Centro de Documentos.';

COMMENT ON TABLE document_upload_batch_items IS
  'Detalle de cada archivo previsualizado y confirmado en un lote documental.';

COMMENT ON COLUMN employee_documents.document_type IS
  'Codigo documental centralizado del documento cargado.';
