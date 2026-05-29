-- Migration 041: Hacer municipality_id opcional en employees.
-- El código ya tiene el comentario "municipalityId = null es aceptable al crear
-- desde la pestaña Identificación; el usuario lo asigna luego en Vinculación."
-- La restricción NOT NULL era inconsistente con esa intención.

BEGIN;

ALTER TABLE employees ALTER COLUMN municipality_id DROP NOT NULL;

COMMIT;
