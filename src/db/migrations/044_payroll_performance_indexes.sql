-- 044_payroll_performance_indexes.sql
-- Índices de rendimiento para el flujo operativo de nómina.
-- Todos los índices críticos que faltaban tras el análisis de las consultas
-- más frecuentes: calculatePayrollGroup, recalculatePayrollItem, getPayrollGroupDetail,
-- pendingNoveltySupportSql (correlated subquery que se ejecuta en cada fila de listados).

DO $$
BEGIN

  -- ── payroll_novelties ────────────────────────────────────────────────────────
  -- Existe: payroll_novelties_period_item_idx ON (payroll_period_id, payroll_item_id)
  -- Faltan:

  -- recalculatePayrollItem: WHERE payroll_item_id = $1  (sin payroll_period_id)
  IF to_regclass('public.payroll_novelties') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_payroll_novelties_item_id
      ON payroll_novelties(payroll_item_id);

    -- calculatePayrollGroup: WHERE payroll_period_id = $1 AND municipality_id = $2
    CREATE INDEX IF NOT EXISTS idx_payroll_novelties_period_municipality
      ON payroll_novelties(payroll_period_id, municipality_id);

    -- listSupportRows / getPayrollGroupDetail: filtra por periodo solo
    CREATE INDEX IF NOT EXISTS idx_payroll_novelties_period_id
      ON payroll_novelties(payroll_period_id);
  END IF;

  -- ── payroll_turn_covers ──────────────────────────────────────────────────────
  -- Existe: payroll_turn_covers_novelty_uk ON (novelty_id)
  -- Faltan:

  IF to_regclass('public.payroll_turn_covers') IS NOT NULL THEN
    -- calculatePayrollGroup + getPayrollGroupDetail: WHERE payroll_period_id = $1 AND cover_type = 'INTERNA'
    CREATE INDEX IF NOT EXISTS idx_payroll_turn_covers_period_type
      ON payroll_turn_covers(payroll_period_id, cover_type);

    -- recalculatePayrollItem: WHERE payroll_period_id = $1 AND cover_type = 'INTERNA' AND internal_employee_id = $2
    CREATE INDEX IF NOT EXISTS idx_payroll_turn_covers_period_interna_emp
      ON payroll_turn_covers(payroll_period_id, internal_employee_id)
      WHERE cover_type = 'INTERNA';

    -- listGroupTurnCovers: JOIN ON ptc.payroll_item_id (sin FK explícita)
    CREATE INDEX IF NOT EXISTS idx_payroll_turn_covers_item_id
      ON payroll_turn_covers(payroll_item_id);
  END IF;

  -- ── novelty_supports ────────────────────────────────────────────────────────
  -- Existen: novelty_supports_status_idx ON (status), novelty_supports_period_idx ON (payroll_period_id)
  -- Falta:

  IF to_regclass('public.novelty_supports') IS NOT NULL THEN
    -- pendingNoveltySupportSql: correlated EXISTS WHERE novelty_id = pn.id
    -- Se ejecuta en CADA FILA de listOperationalPeriods, listPayrollGroups y getPayrollGroupDetail.
    CREATE INDEX IF NOT EXISTS idx_novelty_supports_novelty_id
      ON novelty_supports(novelty_id);

    -- syncNoveltySupportStatus: WHERE novelty_id = $1 con aggregación de status
    CREATE INDEX IF NOT EXISTS idx_novelty_supports_novelty_status
      ON novelty_supports(novelty_id, status)
      WHERE COALESCE(required, true) = true;
  END IF;

  -- ── payroll_items ────────────────────────────────────────────────────────────
  -- Existen: payroll_items_group_employee_uk ON (group_id, employee_id) — cubre WHERE group_id = $1
  --          payroll_items_period_idx ON (period_id)
  --          payroll_items_employee_idx ON (employee_id)
  -- No se agregan más: ya están cubiertos.

  -- ── payroll_groups ────────────────────────────────────────────────────────────
  -- Existen: payroll_groups_period_idx ON (period_id), payroll_groups_uk (unique expression index)
  -- No se agregan más: ya están cubiertos.

END $$;
