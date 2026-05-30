-- 049_cleanup_nonoperario_municipal_groups.sql
-- Elimina grupos municipales de cargos no-OPERARIO que no tengan items revisados.
-- Solo se elimina si todos los items del grupo están sin revisar (no hay pérdida de datos aprobados).
-- Los items eliminados pierden el payroll_item_id en sus novedades (ON DELETE SET NULL),
-- pero pueden recalcularse desde el grupo consolidado.

DELETE FROM payroll_groups
 WHERE municipality_id IS NOT NULL
   AND UPPER(BTRIM(operational_position)) != 'OPERARIO MANIPULADOR DE ALIMENTOS'
   AND NOT EXISTS (
         SELECT 1
           FROM payroll_items pi
          WHERE pi.group_id = payroll_groups.id
            AND pi.reviewed = true
       );
