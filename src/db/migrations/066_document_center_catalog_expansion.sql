-- Migration 066: Expand document_types catalog for Centro de Documentos bulk upload
-- Adds missing document types required by the operational checklist.
-- All inserts are idempotent (ON CONFLICT DO NOTHING / WHERE NOT EXISTS).

BEGIN;

-- Step 1: Ensure master_document_types entries exist for all new codes
INSERT INTO master_document_types (code, name, description, phase, is_global_base, visible_to_auditor, active, default_expires)
VALUES
  ('ANTECEDENTES_CONTRALORIA',   'Antecedentes Contraloría',          'Consulta de antecedentes en la Contraloría General.',         'preingreso', true,  true,  true, false),
  ('ANTECEDENTES_POLICIA',       'Antecedentes Policía',              'Certificado de antecedentes judiciales - Policía Nacional.',  'preingreso', true,  true,  true, false),
  ('ANTECEDENTES_PROCURADURIA',  'Antecedentes Procuraduría',         'Consulta de antecedentes en la Procuraduría General.',        'preingreso', true,  true,  true, false),
  ('REDAM',                      'REDAM',                             'Registro de Deudores Alimentarios Morosos.',                  'preingreso', true,  true,  true, false),
  ('RNMC',                       'RNMC',                              'Registro Nacional de Medidas Correctivas.',                   'preingreso', true,  true,  true, false),
  ('AUTORIZACION_INHABILIDADES', 'Autorización de inhabilidades',     'Autorización e inhabilitaciones para el cargo.',              'preingreso', false, true,  true, false),
  ('AFILIACION_CAJA_COMPENSACION','Afiliación caja de compensación',  'Documento de afiliación a caja de compensación familiar.',    'preingreso', true,  true,  true, false),
  ('EXAMEN_INGRESO',             'Examen de ingreso',                 'Examen médico de ingreso ocupacional.',                       'preingreso', false, true,  true, false),
  ('FORMATO_INDUCCION',          'Formato de inducción',              'Formato de inducción firmado por el empleado.',               'ingreso',    false, false, true, false),
  ('CERTIFICADOS_EXPERIENCIA',   'Certificados de experiencia laboral','Certificados o cartas laborales que acreditan experiencia.', 'preingreso', false, true,  true, false),
  ('ACTA_ENTREGA_DOTACION',      'Acta de entrega de dotación',       'Acta de entrega de dotación firmada.',                       'ingreso',    false, false, true, false)
ON CONFLICT (name) DO UPDATE SET
  code              = EXCLUDED.code,
  description       = EXCLUDED.description,
  phase             = EXCLUDED.phase,
  is_global_base    = EXCLUDED.is_global_base,
  visible_to_auditor= EXCLUDED.visible_to_auditor,
  active            = EXCLUDED.active;

-- Step 2: Insert missing types into document_types, linked to their master entry
-- Uses WHERE NOT EXISTS to avoid duplicates regardless of existing IDs or codes.
INSERT INTO document_types (code, name, phase, required, visible_to_auditor, active, master_document_type_id)
SELECT
  mdt.code,
  mdt.name,
  mdt.phase,
  mdt.is_global_base AS required,
  mdt.visible_to_auditor,
  true,
  mdt.id
FROM master_document_types mdt
WHERE mdt.code IN (
  'ANTECEDENTES_CONTRALORIA',
  'ANTECEDENTES_POLICIA',
  'ANTECEDENTES_PROCURADURIA',
  'REDAM',
  'RNMC',
  'AUTORIZACION_INHABILIDADES',
  'AFILIACION_CAJA_COMPENSACION',
  'EXAMEN_INGRESO',
  'FORMATO_INDUCCION',
  'CERTIFICADOS_EXPERIENCIA',
  'ACTA_ENTREGA_DOTACION'
)
AND NOT EXISTS (
  SELECT 1 FROM document_types dt
  WHERE UPPER(BTRIM(dt.code)) = UPPER(BTRIM(mdt.code))
);

-- Step 3: Backfill master_document_type_id for existing document_types that are missing it
UPDATE document_types dt
SET master_document_type_id = mdt.id
FROM master_document_types mdt
WHERE dt.master_document_type_id IS NULL
  AND UPPER(BTRIM(mdt.code)) = UPPER(BTRIM(dt.code))
  AND COALESCE(dt.active, true) = true;

COMMIT;
