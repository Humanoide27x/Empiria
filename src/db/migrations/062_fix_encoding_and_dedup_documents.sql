-- Migration 062: Corrige encoding corrupto en nombres de tipos documentales
-- y limpia documentos duplicados en employee_documents.
--
-- Contexto:
--   Migraciones antiguas (CP850/Latin-1) almacenaron caracteres corruptos:
--     chr(8218) [U+201A ‚] → debería ser 'é'
--     chr(161)  [U+00A1 ¡] → debería ser 'í'
--     chr(162)  [U+00A2 ¢] → debería ser 'ó'
--     chr(164)  [U+00A4 ¤] → debería ser 'ñ'
--   Migration 061 buscaba por code='CEDULA_DE_CIUDADANIA' pero registros
--   antiguos tienen code='cedula' u otros formatos — no hacían match.

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 1: Corregir encoding en document_types y master_document_types
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r           RECORD;
  new_name    TEXT;
  existing_id BIGINT;
BEGIN

  -- ── document_types ─────────────────────────────────────────────────────────
  FOR r IN
    SELECT id, name, code
    FROM document_types
    WHERE position(chr(8218) in name) > 0
       OR position(chr(161)  in name) > 0
       OR position(chr(162)  in name) > 0
       OR position(chr(164)  in name) > 0
  LOOP
    new_name :=
      replace(replace(replace(replace(
        r.name,
        chr(8218), 'é'),
        chr(161),  'í'),
        chr(162),  'ó'),
        chr(164),  'ñ');

    IF new_name = r.name THEN CONTINUE; END IF;

    SELECT id INTO existing_id
      FROM document_types
     WHERE name = new_name AND id != r.id
     LIMIT 1;

    IF existing_id IS NOT NULL THEN
      UPDATE employee_documents
         SET document_type_id = existing_id
       WHERE document_type_id = r.id;

      UPDATE document_types
         SET code = r.code
       WHERE id = existing_id
         AND (code IS NULL OR BTRIM(code) = '');

      DELETE FROM document_types WHERE id = r.id;
    ELSE
      UPDATE document_types SET name = new_name WHERE id = r.id;
    END IF;

  END LOOP;

  -- ── master_document_types ──────────────────────────────────────────────────
  FOR r IN
    SELECT id, name, code
    FROM master_document_types
    WHERE position(chr(8218) in name) > 0
       OR position(chr(161)  in name) > 0
       OR position(chr(162)  in name) > 0
       OR position(chr(164)  in name) > 0
  LOOP
    new_name :=
      replace(replace(replace(replace(
        r.name,
        chr(8218), 'é'),
        chr(161),  'í'),
        chr(162),  'ó'),
        chr(164),  'ñ');

    IF new_name = r.name THEN CONTINUE; END IF;

    SELECT id INTO existing_id
      FROM master_document_types
     WHERE name = new_name AND id != r.id
     LIMIT 1;

    IF existing_id IS NOT NULL THEN
      UPDATE document_types
         SET master_document_type_id = existing_id
       WHERE master_document_type_id = r.id;

      UPDATE master_document_types
         SET code = r.code
       WHERE id = existing_id
         AND (code IS NULL OR BTRIM(code) = '');

      DELETE FROM master_document_types WHERE id = r.id;
    ELSE
      UPDATE master_document_types SET name = new_name WHERE id = r.id;
    END IF;

  END LOOP;

END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2: Limpiar documentos duplicados en employee_documents
-- Por cada (employee_id, tipo_documental_efectivo), conservar solo el registro
-- más reciente. Los demás se marcan como eliminados (soft delete).
-- ─────────────────────────────────────────────────────────────────────────────
WITH ranked_docs AS (
  SELECT
    ed.id,
    ROW_NUMBER() OVER (
      PARTITION BY
        ed.employee_id,
        COALESCE(
          NULLIF(BTRIM(ed.document_type), ''),
          dt.code,
          ed.document_type_id::TEXT
        )
      ORDER BY
        COALESCE(ed.version, 1) DESC,
        ed.uploaded_at DESC NULLS LAST,
        ed.id DESC
    ) AS rn
  FROM employee_documents ed
  LEFT JOIN document_types dt ON dt.id = ed.document_type_id
  WHERE ed.deleted_at IS NULL
    AND COALESCE(ed.replaced_by_document_id, 0) = 0
    AND COALESCE(
          NULLIF(BTRIM(ed.document_type), ''),
          dt.code,
          ed.document_type_id::TEXT
        ) IS NOT NULL
)
UPDATE employee_documents
   SET deleted_at = NOW(),
       updated_at = NOW(),
       status     = 'DELETED'
 WHERE id IN (SELECT id FROM ranked_docs WHERE rn > 1);
