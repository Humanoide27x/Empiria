-- 051: Índices de rendimiento para tablas de nómina (payroll_items, payroll_groups, novelties, turns)

-- payroll_items: consultados por group_id, period_id y employee_id frecuentemente
CREATE INDEX IF NOT EXISTS idx_payroll_items_group_id
  ON payroll_items(group_id);

CREATE INDEX IF NOT EXISTS idx_payroll_items_period_id
  ON payroll_items(period_id);

CREATE INDEX IF NOT EXISTS idx_payroll_items_employee_id
  ON payroll_items(employee_id);

CREATE INDEX IF NOT EXISTS idx_payroll_items_group_reviewed
  ON payroll_items(group_id, reviewed);

-- payroll_groups: consultados por period_id y status
CREATE INDEX IF NOT EXISTS idx_payroll_groups_period_id
  ON payroll_groups(period_id);

CREATE INDEX IF NOT EXISTS idx_payroll_groups_period_status
  ON payroll_groups(period_id, status);

CREATE INDEX IF NOT EXISTS idx_payroll_groups_contract_period
  ON payroll_groups(contract_id, period_id);

CREATE INDEX IF NOT EXISTS idx_payroll_groups_municipality
  ON payroll_groups(municipality_id) WHERE municipality_id IS NOT NULL;

-- payroll_novelties: consultados por period+municipality y period+employee
CREATE INDEX IF NOT EXISTS idx_payroll_novelties_period_employee
  ON payroll_novelties(payroll_period_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_payroll_novelties_item_type
  ON payroll_novelties(payroll_item_id, novelty_type);

-- payroll_turn_covers: consultados por period_id y cover_type
CREATE INDEX IF NOT EXISTS idx_payroll_turn_covers_period_type
  ON payroll_turn_covers(payroll_period_id, cover_type);

CREATE INDEX IF NOT EXISTS idx_payroll_turn_covers_novelty_id
  ON payroll_turn_covers(novelty_id) WHERE novelty_id IS NOT NULL;

-- novelty_supports: consultados por periodo y estado
CREATE INDEX IF NOT EXISTS idx_novelty_supports_period_status
  ON novelty_supports(payroll_period_id, status)
  WHERE payroll_period_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_novelty_supports_employee
  ON novelty_supports(employee_id) WHERE employee_id IS NOT NULL;

-- employee_requests: consultados por employee_id
CREATE INDEX IF NOT EXISTS idx_employee_requests_employee_id
  ON employee_requests(employee_id) WHERE employee_id IS NOT NULL;
