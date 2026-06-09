-- Fix nombres de tipos documentales con encoding corrupto.
-- Cuando ya existe un registro con el nombre correcto, elimina el duplicado corrupto
-- re-apuntando las FK antes de borrar. Si solo existe el corrupto, lo actualiza.

DO $$
DECLARE
  fix RECORD;
  correct_mdt_id BIGINT;
  corrupt_mdt_id BIGINT;
  correct_dt_id  BIGINT;
  corrupt_dt_id  BIGINT;
BEGIN
  FOR fix IN
    SELECT code, correct_name FROM (VALUES
      ('CEDULA_DE_CIUDADANIA',        'Cédula de ciudadanía'),
      ('AFILIACION_EPS',              'Afiliación EPS'),
      ('AFILIACION_PENSION',          'Afiliación pensión'),
      ('AFILIACION_ARL',              'Afiliación ARL'),
      ('CURSO_MANIPULACION_ALIMENTOS','Curso manipulación alimentos'),
      ('EXAMEN_MANIPULACION_ALIMENTOS','Examen manipulación alimentos'),
      ('CERTIFICACION_BANCARIA',      'Certificación bancaria'),
      ('AUTORIZACION_TRATAMIENTO_DATOS','Autorización tratamiento datos'),
      ('INDUCCION',                   'Inducción'),
      ('DOTACION',                    'Dotación')
    ) AS t(code, correct_name)
  LOOP
    -- ── master_document_types ─────────────────────────────────────────────────
    SELECT id INTO correct_mdt_id FROM master_document_types
      WHERE name = fix.correct_name LIMIT 1;

    SELECT id INTO corrupt_mdt_id FROM master_document_types
      WHERE UPPER(TRIM(code)) = fix.code AND name != fix.correct_name LIMIT 1;

    IF corrupt_mdt_id IS NOT NULL AND correct_mdt_id IS NOT NULL THEN
      -- Re-apuntar document_types que referencian el master corrupto
      UPDATE document_types
        SET master_document_type_id = correct_mdt_id
        WHERE master_document_type_id = corrupt_mdt_id;
      -- Garantizar que el correcto tenga el code
      UPDATE master_document_types
        SET code = fix.code
        WHERE id = correct_mdt_id AND (code IS NULL OR UPPER(TRIM(code)) != fix.code);
      -- Eliminar el duplicado corrupto
      DELETE FROM master_document_types WHERE id = corrupt_mdt_id;

    ELSIF corrupt_mdt_id IS NOT NULL THEN
      -- Solo existe el corrupto: actualizar nombre
      UPDATE master_document_types SET name = fix.correct_name WHERE id = corrupt_mdt_id;
    END IF;

    -- ── document_types ────────────────────────────────────────────────────────
    SELECT id INTO correct_dt_id FROM document_types
      WHERE name = fix.correct_name LIMIT 1;

    SELECT id INTO corrupt_dt_id FROM document_types
      WHERE UPPER(TRIM(code)) = fix.code AND name != fix.correct_name LIMIT 1;

    IF corrupt_dt_id IS NOT NULL AND correct_dt_id IS NOT NULL THEN
      -- Re-apuntar employee_documents que referencian el type corrupto
      UPDATE employee_documents
        SET document_type_id = correct_dt_id
        WHERE document_type_id = corrupt_dt_id;
      -- Garantizar que el correcto tenga el code
      UPDATE document_types
        SET code = fix.code
        WHERE id = correct_dt_id AND (code IS NULL OR UPPER(TRIM(code)) != fix.code);
      -- Eliminar el duplicado corrupto
      DELETE FROM document_types WHERE id = corrupt_dt_id;

    ELSIF corrupt_dt_id IS NOT NULL THEN
      -- Solo existe el corrupto: actualizar nombre
      UPDATE document_types SET name = fix.correct_name WHERE id = corrupt_dt_id;
    END IF;

  END LOOP;
END $$;
