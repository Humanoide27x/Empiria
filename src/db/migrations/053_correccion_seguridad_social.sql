-- 053_correccion_seguridad_social.sql
-- Nuevo tipo de novedad: CORRECCION_SEGURIDAD_SOCIAL
--
-- Permite corregir la fecha usada para calcular los días de Seguridad Social
-- sin modificar la fecha real de ingreso laboral ni los días trabajados/salario.
--
-- Ejemplo:
--   Ingreso laboral : 05/05/2026 → días laborados = 26, salario proporcional 26/30
--   Corrección SS   : 01/05/2026 → días SS = 30  (se reportan 30 días a seguridad social)
--
-- La novedad solo afecta ss_days (calculado en computeSocialSecurityDays).
-- No afecta salario, transporte, recargos ni deducciones.

INSERT INTO payroll_novelty_types (
  code,
  name,
  affects_salary,
  affects_transport,
  affects_recargos,
  affects_deductions,
  requires_turn_cover,
  requires_support,
  active
)
VALUES (
  'CORRECCION_SEGURIDAD_SOCIAL',
  'Corrección Seguridad Social',
  false,   -- no reduce ni aumenta salario devengado
  false,   -- no afecta auxilio de transporte
  false,   -- no afecta recargos
  false,   -- no cambia deducciones (los días SS se ajustan aparte)
  false,   -- no requiere turno de cobertura
  false,   -- no requiere soporte documental obligatorio
  true
)
ON CONFLICT (code) DO UPDATE SET
  name               = EXCLUDED.name,
  affects_salary     = EXCLUDED.affects_salary,
  affects_transport  = EXCLUDED.affects_transport,
  affects_recargos   = EXCLUDED.affects_recargos,
  affects_deductions = EXCLUDED.affects_deductions,
  requires_turn_cover= EXCLUDED.requires_turn_cover,
  requires_support   = EXCLUDED.requires_support,
  active             = EXCLUDED.active;
