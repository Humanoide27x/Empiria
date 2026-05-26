-- =====================================================================
-- Vistas operativas sobre la arquitectura contractual enterprise.
-- Facilitan consultas backend sin cambiar aun la UI ni romper modulos
-- existentes.
-- =====================================================================

ALTER TABLE employee_experiences
  DROP CONSTRAINT IF EXISTS employee_experiences_employee_assignment_id_fkey;

ALTER TABLE employee_experiences
  ADD CONSTRAINT employee_experiences_employee_assignment_id_fkey
  FOREIGN KEY (employee_assignment_id)
  REFERENCES employee_contract_assignments(id)
  ON DELETE SET NULL;

COMMENT ON TABLE employee_contracts IS
  'Tabla legado previa a employee_contract_assignments. Se conserva por compatibilidad y trazabilidad.';

COMMENT ON COLUMN employees.company_id IS
  'Snapshot operativo legado del contrato/empresa actual. La relacion contractual enterprise vive en employee_contract_assignments.';

COMMENT ON COLUMN employees.contract_id IS
  'Snapshot operativo legado del contrato actual. La relacion contractual enterprise vive en employee_contract_assignments.';

COMMENT ON COLUMN employees.municipality_id IS
  'Municipio principal legado del empleado. La cobertura multi-municipio se modela en employee_assignment_municipalities.';

CREATE OR REPLACE VIEW v_employee_current_assignments AS
SELECT
  eca.id AS assignment_id,
  eca.employee_id,
  e.full_name AS employee_name,
  e.document_number,
  eca.tenant_id,
  eca.company_id,
  c.name AS company_name,
  eca.contract_id,
  ct.name AS contract_name,
  eca.contract_position_rule_id,
  cpr.code AS contract_position_code,
  cpr.name AS contract_position_name,
  eca.master_position_id,
  mp.code AS master_position_code,
  eca.bid_position_name,
  eca.operational_position_name,
  eca.document_rule_source,
  eca.area_code,
  ma.name AS area_name,
  eca.municipality_id,
  m.name AS municipality_name,
  eca.institution_id,
  i.name AS institution_name,
  eca.site_id,
  es.name AS site_name,
  eca.master_modality_id,
  mm.code AS modality_code,
  COALESCE(NULLIF(BTRIM(eca.modality_name), ''), mm.name) AS modality_name,
  eca.workday_type,
  eca.presented_in_bid,
  eca.staffing_type,
  eca.coverage_enabled,
  eca.manages_multiple_municipalities,
  eca.assignment_start_date,
  eca.assignment_end_date,
  eca.status,
  eca.notes,
  eca.active,
  eca.created_at,
  eca.updated_at
FROM employee_contract_assignments eca
JOIN employees e ON e.id = eca.employee_id
JOIN companies c ON c.id = eca.company_id
JOIN contracts ct ON ct.id = eca.contract_id
LEFT JOIN contract_position_rules cpr ON cpr.id = eca.contract_position_rule_id
LEFT JOIN master_positions mp ON mp.id = eca.master_position_id
LEFT JOIN master_areas ma ON ma.code = eca.area_code
LEFT JOIN municipalities m ON m.id = eca.municipality_id
LEFT JOIN institutions i ON i.id = eca.institution_id
LEFT JOIN educational_sites es ON es.id = eca.site_id
LEFT JOIN master_modalities mm ON mm.id = eca.master_modality_id
WHERE eca.active = true
  AND eca.assignment_end_date IS NULL;

COMMENT ON VIEW v_employee_current_assignments IS
  'Vista de asignaciones contractuales activas para consumo backend.';

CREATE OR REPLACE VIEW v_contract_effective_document_rules AS
WITH global_docs AS (
  SELECT
    ct.tenant_id,
    ct.company_id,
    ct.id AS contract_id,
    NULL::INTEGER AS contract_position_rule_id,
    mdt.id AS master_document_type_id,
    mdt.code AS document_code,
    mdt.name AS document_name,
    mdt.phase,
    'BASE_GLOBAL'::TEXT AS rule_origin,
    'ANY'::TEXT AS applies_to_staffing_type,
    true AS required,
    false AS expires,
    NULL::INTEGER AS alert_days_before_expiration,
    true AS requires_approval,
    'DOCUMENTAL'::TEXT AS validation_mode,
    NULL::INTEGER AS master_modality_id,
    NULL::INTEGER AS municipality_id,
    NULL::INTEGER AS institution_id,
    NULL::INTEGER AS site_id,
    mdt.visible_to_auditor,
    mdt.active
  FROM contracts ct
  CROSS JOIN master_document_types mdt
  WHERE mdt.is_global_base = true
    AND mdt.active = true
),
contractual_docs AS (
  SELECT
    cdr.tenant_id,
    cdr.company_id,
    cdr.contract_id,
    cdr.contract_position_rule_id,
    cdr.master_document_type_id,
    mdt.code AS document_code,
    mdt.name AS document_name,
    mdt.phase,
    'CONTRACTUAL'::TEXT AS rule_origin,
    cdr.applies_to_staffing_type,
    cdr.required,
    cdr.expires,
    cdr.alert_days_before_expiration,
    cdr.requires_approval,
    cdr.validation_mode,
    cdr.master_modality_id,
    cdr.municipality_id,
    cdr.institution_id,
    cdr.site_id,
    mdt.visible_to_auditor,
    cdr.active
  FROM contract_document_rules cdr
  JOIN master_document_types mdt ON mdt.id = cdr.master_document_type_id
  WHERE cdr.active = true
)
SELECT * FROM global_docs
UNION ALL
SELECT * FROM contractual_docs;

COMMENT ON VIEW v_contract_effective_document_rules IS
  'Reglas documentales efectivas por contrato: base global + reglas contractuales.';

CREATE OR REPLACE VIEW v_employee_effective_document_rules AS
WITH current_assignments AS (
  SELECT *
  FROM v_employee_current_assignments
),
global_rules AS (
  SELECT
    ca.assignment_id,
    ca.employee_id,
    ca.company_id,
    ca.contract_id,
    ca.contract_position_rule_id,
    ca.staffing_type,
    ca.municipality_id,
    ca.institution_id,
    ca.site_id,
    ca.master_modality_id,
    vr.master_document_type_id,
    vr.document_code,
    vr.document_name,
    vr.phase,
    vr.rule_origin,
    vr.required,
    vr.expires,
    vr.alert_days_before_expiration,
    vr.requires_approval,
    vr.validation_mode,
    vr.visible_to_auditor
  FROM current_assignments ca
  JOIN v_contract_effective_document_rules vr
    ON vr.contract_id = ca.contract_id
   AND vr.rule_origin = 'BASE_GLOBAL'
),
contract_rules AS (
  SELECT
    ca.assignment_id,
    ca.employee_id,
    ca.company_id,
    ca.contract_id,
    ca.contract_position_rule_id,
    ca.staffing_type,
    ca.municipality_id,
    ca.institution_id,
    ca.site_id,
    ca.master_modality_id,
    vr.master_document_type_id,
    vr.document_code,
    vr.document_name,
    vr.phase,
    vr.rule_origin,
    vr.required,
    vr.expires,
    vr.alert_days_before_expiration,
    vr.requires_approval,
    vr.validation_mode,
    vr.visible_to_auditor
  FROM current_assignments ca
  JOIN v_contract_effective_document_rules vr
    ON vr.contract_id = ca.contract_id
   AND vr.rule_origin = 'CONTRACTUAL'
   AND (vr.contract_position_rule_id IS NULL OR vr.contract_position_rule_id = ca.contract_position_rule_id)
   AND (vr.applies_to_staffing_type = 'ANY' OR vr.applies_to_staffing_type = ca.staffing_type)
   AND (vr.master_modality_id IS NULL OR vr.master_modality_id = ca.master_modality_id)
   AND (vr.municipality_id IS NULL OR vr.municipality_id = ca.municipality_id)
   AND (vr.institution_id IS NULL OR vr.institution_id = ca.institution_id)
   AND (vr.site_id IS NULL OR vr.site_id = ca.site_id)
)
SELECT * FROM global_rules
UNION ALL
SELECT * FROM contract_rules;

COMMENT ON VIEW v_employee_effective_document_rules IS
  'Documentos efectivos por asignacion activa del empleado.';

CREATE OR REPLACE VIEW v_employee_experience_summary AS
SELECT
  ee.employee_id,
  ee.master_experience_type_id,
  met.code AS experience_type_code,
  met.name AS experience_type_name,
  COUNT(*) FILTER (WHERE ee.active = true) AS records_count,
  COALESCE(SUM(ee.months_calculated) FILTER (WHERE ee.active = true), 0) AS total_months,
  COALESCE(SUM(ee.months_calculated) FILTER (WHERE ee.active = true AND ee.validated = true), 0) AS validated_months,
  MAX(ee.end_date) FILTER (WHERE ee.active = true) AS latest_end_date
FROM employee_experiences ee
JOIN master_experience_types met ON met.id = ee.master_experience_type_id
GROUP BY
  ee.employee_id,
  ee.master_experience_type_id,
  met.code,
  met.name;

COMMENT ON VIEW v_employee_experience_summary IS
  'Resumen de experiencia estructurada por empleado y tipo.';

CREATE OR REPLACE VIEW v_contract_rule_summary AS
SELECT
  ct.id AS contract_id,
  ct.company_id,
  ct.tenant_id,
  ct.name AS contract_name,
  COUNT(DISTINCT cpr.id) FILTER (WHERE cpr.active = true) AS position_rules_count,
  COUNT(DISTINCT cdr.id) FILTER (WHERE cdr.active = true) AS document_rules_count,
  COUNT(DISTINCT cer.id) FILTER (WHERE cer.active = true) AS experience_rules_count,
  COUNT(DISTINCT ccr.id) FILTER (WHERE ccr.active = true AND ccr.enabled = true) AS coverage_rules_count,
  COUNT(DISTINCT cm.municipality_id) FILTER (WHERE cm.active = true) AS municipalities_count,
  COUNT(DISTINCT cmod.id) FILTER (WHERE cmod.active = true) AS modalities_count
FROM contracts ct
LEFT JOIN contract_position_rules cpr ON cpr.contract_id = ct.id
LEFT JOIN contract_document_rules cdr ON cdr.contract_id = ct.id
LEFT JOIN contract_experience_rules cer ON cer.contract_id = ct.id
LEFT JOIN contract_coverage_rules ccr ON ccr.contract_id = ct.id
LEFT JOIN contract_municipalities cm ON cm.contract_id = ct.id
LEFT JOIN contract_modalities cmod ON cmod.contract_id = ct.id
GROUP BY
  ct.id,
  ct.company_id,
  ct.tenant_id,
  ct.name;

COMMENT ON VIEW v_contract_rule_summary IS
  'Resumen backend del nivel de configuracion contractual enterprise.';
