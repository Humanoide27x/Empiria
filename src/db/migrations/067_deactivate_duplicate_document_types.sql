-- Migration 067: Deactivate legacy document_types entries superseded by migration 066
--
-- Migration 066 inserted new entries with proper uppercase codes but the same display
-- names as existing legacy rows, causing duplicate options in the bulk upload selector:
--   "Antecedentes Contraloría"        → code='contraloria'  vs  code='ANTECEDENTES_CONTRALORIA'
--   "Antecedentes Procuraduría"       → code='procuraduria' vs  code='ANTECEDENTES_PROCURADURIA'
--   "Afiliación caja de compensación" → id=35 (old code)    vs  code='AFILIACION_CAJA_COMPENSACION'
--
-- Rows are deactivated (active = false) rather than deleted to preserve FK references
-- in employee_documents. Each UPDATE fires only if its 066 replacement already exists.

BEGIN;

-- 1. Deactivate old 'contraloria' (superseded by ANTECEDENTES_CONTRALORIA)
UPDATE document_types
   SET active = false
 WHERE UPPER(BTRIM(code)) = 'CONTRALORIA'
   AND COALESCE(active, true) = true
   AND EXISTS (
     SELECT 1 FROM document_types
      WHERE UPPER(BTRIM(code)) = 'ANTECEDENTES_CONTRALORIA'
        AND COALESCE(active, true) = true
   );

-- 2. Deactivate old 'procuraduria' (superseded by ANTECEDENTES_PROCURADURIA)
UPDATE document_types
   SET active = false
 WHERE UPPER(BTRIM(code)) = 'PROCURADURIA'
   AND COALESCE(active, true) = true
   AND EXISTS (
     SELECT 1 FROM document_types
      WHERE UPPER(BTRIM(code)) = 'ANTECEDENTES_PROCURADURIA'
        AND COALESCE(active, true) = true
   );

-- 3. Deactivate old caja entry (id=35, superseded by AFILIACION_CAJA_COMPENSACION)
UPDATE document_types
   SET active = false
 WHERE id = 35
   AND COALESCE(active, true) = true
   AND EXISTS (
     SELECT 1 FROM document_types
      WHERE UPPER(BTRIM(code)) = 'AFILIACION_CAJA_COMPENSACION'
        AND COALESCE(active, true) = true
   );

COMMIT;
