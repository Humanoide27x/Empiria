-- Migration 063: Limpieza de la matriz documental
-- Elimina tipos duplicados, fusiona Curso+Examen manipulación,
-- corrige encoding corrupto y renombra entradas ambiguas.
-- Todos los tipos eliminados tienen 0 documentos en employee_documents.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Corregir encoding corrupto (debe ir antes de las renombraciones)
--    chr(8218)→é  chr(161)→í  chr(162)→ó  chr(164)→ñ
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE document_types
   SET name = replace(replace(replace(replace(
               name,
               chr(8218), 'é'),
               chr(161),  'í'),
               chr(162),  'ó'),
               chr(164),  'ñ')
 WHERE position(chr(8218) IN name) > 0
    OR position(chr(161)  IN name) > 0
    OR position(chr(162)  IN name) > 0
    OR position(chr(164)  IN name) > 0;

UPDATE master_document_types
   SET name = replace(replace(replace(replace(
               name,
               chr(8218), 'é'),
               chr(161),  'í'),
               chr(162),  'ó'),
               chr(164),  'ñ')
 WHERE position(chr(8218) IN name) > 0
    OR position(chr(161)  IN name) > 0
    OR position(chr(162)  IN name) > 0
    OR position(chr(164)  IN name) > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Eliminar duplicados (0 documentos cargados en todos)
-- ─────────────────────────────────────────────────────────────────────────────

-- queda Certificados de experiencia laboral (id=39)
DELETE FROM document_types WHERE id = 37; -- Certificados laborales
DELETE FROM document_types WHERE id = 23; -- Certificación laboral

-- queda Acta de entrega de dotación (id=30)
DELETE FROM document_types WHERE id = 16; -- Formato de dotación

-- queda Certificación bancaria (id=14)
DELETE FROM document_types WHERE id = 38; -- Certificado bancario

-- queda Afiliación caja de compensación (id=35)
DELETE FROM document_types WHERE id = 20; -- Certificado caja de compensación Cofrem

-- queda Afiliación EPS (id=33)
DELETE FROM document_types WHERE id = 18; -- Certificado de afiliación o radicación EPS

-- queda Afiliación fondo de pensión (id=34)
DELETE FROM document_types WHERE id = 19; -- Certificado fondo de pensiones

-- RUT y Desprendible de pago se eliminan de la matriz documental manual
DELETE FROM document_types WHERE id = 36; -- RUT
DELETE FROM document_types WHERE id = 22; -- Desprendible de pago

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fusionar Curso + Examen de manipulación de alimentos
-- ─────────────────────────────────────────────────────────────────────────────

-- Redirigir documentos cargados al tipo que queda (id=3)
UPDATE employee_documents SET document_type_id = 3 WHERE document_type_id = 4;

UPDATE document_types
   SET name = 'Curso y examen de manipulación de alimentos',
       code = 'curso_examen_manipulacion_alimentos'
 WHERE id = 3;

DELETE FROM document_types WHERE id = 4; -- Examen de manipulación de alimentos

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Renombrar entradas ambiguas
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE document_types
   SET name = 'Autorización tratamiento datos'
 WHERE id = 7;

COMMIT;
