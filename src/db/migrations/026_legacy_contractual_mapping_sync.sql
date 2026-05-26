-- =====================================================================
-- Sincronizacion idempotente del legado hacia la arquitectura contractual.
-- No elimina tablas ni datos; solo completa puentes y backfill seguro.
-- Compatible con 021, 022, 023, 024 y 025.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Indices de apoyo para remapeo incremental y consultas de compatibilidad
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS contract_positions_contract_name_idx
  ON contract_positions (contract_id, UPPER(BTRIM(name)));

CREATE INDEX IF NOT EXISTS document_types_code_lower_idx
  ON document_types (LOWER(BTRIM(code)));

CREATE INDEX IF NOT EXISTS document_types_name_upper_idx
  ON document_types (UPPER(BTRIM(name)));

CREATE INDEX IF NOT EXISTS employee_documents_employee_doc_assignment_idx
  ON employee_documents (employee_id, master_document_type_id, employee_assignment_id);

CREATE INDEX IF NOT EXISTS employee_contract_assignments_employee_contract_idx
  ON employee_contract_assignments (employee_id, contract_id, active);

-- ---------------------------------------------------------------------
-- 1. document_types -> master_document_types
-- ---------------------------------------------------------------------

WITH legacy_document_candidates AS (
  SELECT DISTINCT
    CASE
      WHEN NULLIF(LOWER(BTRIM(dt.code)), '') IS NOT NULL THEN LOWER(BTRIM(dt.code))
      ELSE 'legacy_doc_' || SUBSTRING(MD5(UPPER(BTRIM(dt.name))) FROM 1 FOR 12)
    END AS canonical_code,
    NULLIF(BTRIM(dt.name), '') AS canonical_name,
    NULLIF(BTRIM(dt.phase), '') AS canonical_phase,
    COALESCE(dt.visible_to_auditor, false) AS visible_to_auditor,
    COALESCE(dt.active, true) AS active
  FROM document_types dt
  WHERE NULLIF(BTRIM(COALESCE(dt.code, '')), '') IS NOT NULL
     OR NULLIF(BTRIM(COALESCE(dt.name, '')), '') IS NOT NULL
)
INSERT INTO master_document_types (
  code,
  name,
  description,
  phase,
  is_global_base,
  visible_to_auditor,
  active
)
SELECT
  ldc.canonical_code,
  COALESCE(ldc.canonical_name, UPPER(ldc.canonical_code)),
  'Documento legado sincronizado desde document_types.',
  ldc.canonical_phase,
  false,
  ldc.visible_to_auditor,
  ldc.active
FROM legacy_document_candidates ldc
WHERE NOT EXISTS (
  SELECT 1
  FROM master_document_types mdt
  WHERE LOWER(BTRIM(mdt.code)) = ldc.canonical_code
     OR (
       ldc.canonical_name IS NOT NULL
       AND UPPER(BTRIM(mdt.name)) = UPPER(ldc.canonical_name)
     )
);

UPDATE document_types dt
SET master_document_type_id = mdt.id
FROM master_document_types mdt
WHERE dt.master_document_type_id IS NULL
  AND (
    (
      NULLIF(LOWER(BTRIM(dt.code)), '') IS NOT NULL
      AND LOWER(BTRIM(mdt.code)) = LOWER(BTRIM(dt.code))
    )
    OR (
      NULLIF(BTRIM(dt.name), '') IS NOT NULL
      AND UPPER(BTRIM(mdt.name)) = UPPER(BTRIM(dt.name))
    )
  );

UPDATE employee_documents ed
SET master_document_type_id = dt.master_document_type_id
FROM document_types dt
WHERE ed.document_type_id = dt.id
  AND ed.master_document_type_id IS NULL
  AND dt.master_document_type_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. contract_positions / employees -> master_positions
-- ---------------------------------------------------------------------

WITH legacy_contract_position_catalog AS (
  SELECT DISTINCT ON (signature)
    signature,
    generated_code,
    bid_position_name,
    operational_position_name,
    document_rule_source,
    category,
    counts_for_coverage,
    active
  FROM (
    SELECT
      CASE
        WHEN UPPER(BTRIM(COALESCE(cp.category, ''))) = 'EXTRA'
          THEN 'EXTRA|' || UPPER(BTRIM(cp.name))
        ELSE 'BID|' || UPPER(BTRIM(cp.name))
      END AS signature,
      'LCP_' || UPPER(SUBSTRING(MD5(
        CASE
          WHEN UPPER(BTRIM(COALESCE(cp.category, ''))) = 'EXTRA'
            THEN 'EXTRA|' || UPPER(BTRIM(cp.name))
          ELSE 'BID|' || UPPER(BTRIM(cp.name))
        END
      ) FROM 1 FOR 10)) AS generated_code,
      CASE
        WHEN UPPER(BTRIM(COALESCE(cp.category, ''))) = 'EXTRA' THEN 'EXTRA'
        ELSE BTRIM(cp.name)
      END AS bid_position_name,
      CASE
        WHEN UPPER(BTRIM(COALESCE(cp.category, ''))) = 'EXTRA' THEN BTRIM(cp.name)
        ELSE NULL
      END AS operational_position_name,
      BTRIM(cp.name) AS document_rule_source,
      NULLIF(BTRIM(cp.category), '') AS category,
      COALESCE(cp.counts_for_coverage, false) AS counts_for_coverage,
      COALESCE(cp.active, true) AS active
    FROM contract_positions cp
    WHERE NULLIF(BTRIM(cp.name), '') IS NOT NULL
  ) src
  ORDER BY signature
)
INSERT INTO master_positions (
  code,
  bid_position_name,
  operational_position_name,
  document_rule_source,
  category,
  area,
  counts_for_coverage,
  risk_level,
  active
)
SELECT
  lcpc.generated_code,
  lcpc.bid_position_name,
  lcpc.operational_position_name,
  lcpc.document_rule_source,
  lcpc.category,
  NULL,
  lcpc.counts_for_coverage,
  NULL,
  lcpc.active
FROM legacy_contract_position_catalog lcpc
WHERE NOT EXISTS (
  SELECT 1
  FROM master_positions mp
  WHERE UPPER(BTRIM(mp.document_rule_source)) = UPPER(lcpc.document_rule_source)
     OR (
       lcpc.bid_position_name = 'EXTRA'
       AND UPPER(BTRIM(COALESCE(mp.bid_position_name, ''))) = 'EXTRA'
       AND UPPER(BTRIM(COALESCE(mp.operational_position_name, ''))) = UPPER(lcpc.operational_position_name)
     )
     OR (
       lcpc.bid_position_name <> 'EXTRA'
       AND UPPER(BTRIM(COALESCE(mp.bid_position_name, ''))) = UPPER(lcpc.bid_position_name)
     )
);

WITH legacy_employee_position_catalog AS (
  SELECT DISTINCT ON (signature)
    signature,
    generated_code,
    bid_position_name,
    operational_position_name,
    document_rule_source
  FROM (
    SELECT
      'BID|' || UPPER(BTRIM(COALESCE(e.offered_position, e.offer_position))) AS signature,
      'LEB_' || UPPER(SUBSTRING(MD5('BID|' || UPPER(BTRIM(COALESCE(e.offered_position, e.offer_position)))) FROM 1 FOR 10)) AS generated_code,
      BTRIM(COALESCE(e.offered_position, e.offer_position)) AS bid_position_name,
      NULL::TEXT AS operational_position_name,
      BTRIM(COALESCE(e.offered_position, e.offer_position)) AS document_rule_source
    FROM employees e
    WHERE e.presented_in_offer = true
      AND NULLIF(BTRIM(COALESCE(e.offered_position, e.offer_position)), '') IS NOT NULL

    UNION ALL

    SELECT
      'EXTRA|' || UPPER(BTRIM(e.real_position)) AS signature,
      'LEE_' || UPPER(SUBSTRING(MD5('EXTRA|' || UPPER(BTRIM(e.real_position))) FROM 1 FOR 10)) AS generated_code,
      'EXTRA' AS bid_position_name,
      BTRIM(e.real_position) AS operational_position_name,
      BTRIM(e.real_position) AS document_rule_source
    FROM employees e
    WHERE COALESCE(e.presented_in_offer, false) = false
      AND NULLIF(BTRIM(e.real_position), '') IS NOT NULL
  ) src
  ORDER BY signature
)
INSERT INTO master_positions (
  code,
  bid_position_name,
  operational_position_name,
  document_rule_source,
  category,
  area,
  counts_for_coverage,
  risk_level,
  active
)
SELECT
  lepc.generated_code,
  lepc.bid_position_name,
  lepc.operational_position_name,
  lepc.document_rule_source,
  NULL,
  NULL,
  false,
  NULL,
  true
FROM legacy_employee_position_catalog lepc
WHERE NOT EXISTS (
  SELECT 1
  FROM master_positions mp
  WHERE UPPER(BTRIM(mp.document_rule_source)) = UPPER(lepc.document_rule_source)
     OR (
       lepc.bid_position_name = 'EXTRA'
       AND UPPER(BTRIM(COALESCE(mp.bid_position_name, ''))) = 'EXTRA'
       AND UPPER(BTRIM(COALESCE(mp.operational_position_name, ''))) = UPPER(COALESCE(lepc.operational_position_name, ''))
     )
     OR (
       lepc.bid_position_name <> 'EXTRA'
       AND UPPER(BTRIM(COALESCE(mp.bid_position_name, ''))) = UPPER(lepc.bid_position_name)
     )
);

-- ---------------------------------------------------------------------
-- 3. contract_positions -> contract_position_rules
-- ---------------------------------------------------------------------

UPDATE contract_position_rules cpr
SET master_position_id = COALESCE((
  SELECT mp1.id
  FROM master_positions mp1
  WHERE (
      UPPER(BTRIM(COALESCE(cpr.bid_position_name, ''))) = 'EXTRA'
      AND UPPER(BTRIM(COALESCE(mp1.bid_position_name, ''))) = 'EXTRA'
      AND (
        UPPER(BTRIM(COALESCE(mp1.operational_position_name, ''))) = UPPER(BTRIM(COALESCE(cpr.operational_position_name, cpr.document_rule_source)))
        OR UPPER(BTRIM(mp1.document_rule_source)) = UPPER(BTRIM(cpr.document_rule_source))
      )
    )
    OR (
      UPPER(BTRIM(COALESCE(cpr.bid_position_name, ''))) <> 'EXTRA'
      AND (
        UPPER(BTRIM(COALESCE(mp1.bid_position_name, ''))) = UPPER(BTRIM(COALESCE(cpr.bid_position_name, cpr.document_rule_source)))
        OR UPPER(BTRIM(mp1.document_rule_source)) = UPPER(BTRIM(cpr.document_rule_source))
      )
    )
  ORDER BY mp1.id
  LIMIT 1
), cpr.master_position_id)
WHERE cpr.master_position_id IS NULL;

UPDATE contract_position_rules cpr
SET area_code = COALESCE((
  SELECT ma.code
  FROM master_positions mp
  JOIN master_areas ma
    ON mp.area IS NOT NULL
   AND (
     UPPER(BTRIM(ma.code)) = UPPER(BTRIM(mp.area))
     OR UPPER(BTRIM(ma.name)) = UPPER(BTRIM(mp.area))
   )
  WHERE mp.id = cpr.master_position_id
  ORDER BY ma.code
  LIMIT 1
), cpr.area_code)
WHERE cpr.area_code IS NULL;

INSERT INTO contract_position_rules (
  tenant_id,
  company_id,
  contract_id,
  legacy_contract_position_id,
  master_position_id,
  code,
  name,
  bid_position_name,
  operational_position_name,
  document_rule_source,
  category,
  area_code,
  counts_for_coverage,
  is_minimum_team,
  allows_extra_personnel,
  manages_multiple_municipalities,
  profile_level,
  position_type,
  active
)
SELECT
  COALESCE(cp.tenant_id, ct.tenant_id, c.tenant_id, 1) AS tenant_id,
  cp.company_id,
  cp.contract_id,
  cp.id AS legacy_contract_position_id,
  mp.id AS master_position_id,
  COALESCE(mp.code, 'CPR-' || cp.id::TEXT) AS code,
  BTRIM(cp.name) AS name,
  CASE
    WHEN UPPER(BTRIM(COALESCE(cp.category, ''))) = 'EXTRA' THEN 'EXTRA'
    ELSE BTRIM(cp.name)
  END AS bid_position_name,
  CASE
    WHEN UPPER(BTRIM(COALESCE(cp.category, ''))) = 'EXTRA' THEN BTRIM(cp.name)
    ELSE NULL
  END AS operational_position_name,
  BTRIM(cp.name) AS document_rule_source,
  NULLIF(BTRIM(cp.category), '') AS category,
  ma.code AS area_code,
  COALESCE(cp.counts_for_coverage, false),
  UPPER(BTRIM(COALESCE(cp.category, ''))) = 'OFERTA',
  true,
  false,
  NULLIF(BTRIM(cp.profile_level), ''),
  NULLIF(BTRIM(cp.position_type), ''),
  COALESCE(cp.active, true)
FROM contract_positions cp
JOIN contracts ct ON ct.id = cp.contract_id
JOIN companies c ON c.id = cp.company_id
LEFT JOIN LATERAL (
  SELECT mp1.*
  FROM master_positions mp1
  WHERE UPPER(BTRIM(mp1.document_rule_source)) = UPPER(BTRIM(cp.name))
     OR UPPER(BTRIM(COALESCE(mp1.bid_position_name, ''))) = UPPER(BTRIM(cp.name))
     OR UPPER(BTRIM(COALESCE(mp1.operational_position_name, ''))) = UPPER(BTRIM(cp.name))
  ORDER BY mp1.id
  LIMIT 1
) mp ON true
LEFT JOIN master_areas ma
  ON mp.area IS NOT NULL
 AND (
   UPPER(BTRIM(ma.code)) = UPPER(BTRIM(mp.area))
   OR UPPER(BTRIM(ma.name)) = UPPER(BTRIM(mp.area))
 )
WHERE NOT EXISTS (
  SELECT 1
  FROM contract_position_rules cpr
  WHERE cpr.legacy_contract_position_id = cp.id
);

-- ---------------------------------------------------------------------
-- 4. contract_position_documents -> contract_document_rules
-- ---------------------------------------------------------------------

INSERT INTO contract_document_rules (
  tenant_id,
  company_id,
  contract_id,
  contract_position_rule_id,
  master_document_type_id,
  applies_to_staffing_type,
  required,
  expires,
  alert_days_before_expiration,
  requires_approval,
  validation_mode,
  active
)
SELECT
  COALESCE(cpr.tenant_id, 1),
  cpr.company_id,
  cpr.contract_id,
  cpr.id,
  dt.master_document_type_id,
  'ANY',
  COALESCE(cpd.required, true),
  COALESCE(cpd.expires, false),
  cpd.alert_days_before_expiration,
  true,
  'DOCUMENTAL',
  true
FROM contract_position_documents cpd
JOIN contract_positions cp ON cp.id = cpd.contract_position_id
JOIN contract_position_rules cpr ON cpr.legacy_contract_position_id = cp.id
JOIN document_types dt ON dt.id = cpd.document_type_id
WHERE dt.master_document_type_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM contract_document_rules cdr
    WHERE cdr.contract_position_rule_id = cpr.id
      AND cdr.master_document_type_id = dt.master_document_type_id
      AND COALESCE(cdr.master_modality_id, 0) = 0
      AND COALESCE(cdr.municipality_id, 0) = 0
      AND COALESCE(cdr.institution_id, 0) = 0
      AND COALESCE(cdr.site_id, 0) = 0
      AND cdr.applies_to_staffing_type = 'ANY'
  );

-- ---------------------------------------------------------------------
-- 5. employees -> employee_contract_assignments
-- ---------------------------------------------------------------------

UPDATE employee_contract_assignments eca
SET contract_position_rule_id = COALESCE((
  SELECT cpr1.id
  FROM contract_position_rules cpr1
  WHERE cpr1.contract_id = eca.contract_id
    AND cpr1.active = true
    AND (
      UPPER(BTRIM(cpr1.document_rule_source)) = UPPER(BTRIM(eca.document_rule_source))
      OR (
        UPPER(BTRIM(COALESCE(eca.bid_position_name, ''))) = 'EXTRA'
        AND UPPER(BTRIM(COALESCE(cpr1.operational_position_name, ''))) = UPPER(BTRIM(COALESCE(eca.operational_position_name, eca.document_rule_source)))
      )
      OR (
        UPPER(BTRIM(COALESCE(eca.bid_position_name, ''))) <> 'EXTRA'
        AND UPPER(BTRIM(COALESCE(cpr1.bid_position_name, ''))) = UPPER(BTRIM(COALESCE(eca.bid_position_name, eca.document_rule_source)))
      )
    )
  ORDER BY cpr1.id
  LIMIT 1
), eca.contract_position_rule_id)
WHERE eca.contract_position_rule_id IS NULL;

UPDATE employee_contract_assignments eca
SET master_position_id = COALESCE((
  SELECT mp1.id
  FROM master_positions mp1
  WHERE (
      UPPER(BTRIM(COALESCE(eca.bid_position_name, ''))) = 'EXTRA'
      AND UPPER(BTRIM(COALESCE(mp1.bid_position_name, ''))) = 'EXTRA'
      AND (
        UPPER(BTRIM(COALESCE(mp1.operational_position_name, ''))) = UPPER(BTRIM(COALESCE(eca.operational_position_name, eca.document_rule_source)))
        OR UPPER(BTRIM(mp1.document_rule_source)) = UPPER(BTRIM(eca.document_rule_source))
      )
    )
    OR (
      UPPER(BTRIM(COALESCE(eca.bid_position_name, ''))) <> 'EXTRA'
      AND (
        UPPER(BTRIM(COALESCE(mp1.bid_position_name, ''))) = UPPER(BTRIM(COALESCE(eca.bid_position_name, eca.document_rule_source)))
        OR UPPER(BTRIM(mp1.document_rule_source)) = UPPER(BTRIM(eca.document_rule_source))
      )
    )
  ORDER BY mp1.id
  LIMIT 1
), eca.master_position_id)
WHERE eca.master_position_id IS NULL;

UPDATE employee_contract_assignments eca
SET area_code = COALESCE((
  SELECT COALESCE(
    cpr.area_code,
    (
      SELECT ma.code
      FROM master_positions mp
      JOIN master_areas ma
        ON mp.area IS NOT NULL
       AND (
         UPPER(BTRIM(ma.code)) = UPPER(BTRIM(mp.area))
         OR UPPER(BTRIM(ma.name)) = UPPER(BTRIM(mp.area))
       )
      WHERE mp.id = eca.master_position_id
      ORDER BY ma.code
      LIMIT 1
    )
  )
  FROM contract_position_rules cpr
  WHERE cpr.id = eca.contract_position_rule_id
), eca.area_code)
WHERE eca.area_code IS NULL;

INSERT INTO employee_contract_assignments (
  employee_id,
  tenant_id,
  company_id,
  contract_id,
  contract_position_rule_id,
  master_position_id,
  bid_position_name,
  operational_position_name,
  document_rule_source,
  area_code,
  municipality_id,
  institution_id,
  site_id,
  master_modality_id,
  modality_name,
  workday_type,
  presented_in_bid,
  staffing_type,
  coverage_enabled,
  manages_multiple_municipalities,
  assignment_start_date,
  status,
  active
)
SELECT
  e.id AS employee_id,
  COALESCE(e.tenant_id, 1),
  e.company_id,
  e.contract_id,
  cpr.id AS contract_position_rule_id,
  mp.id AS master_position_id,
  CASE
    WHEN e.presented_in_offer = true
      AND NULLIF(BTRIM(COALESCE(e.offered_position, e.offer_position)), '') IS NOT NULL
      THEN BTRIM(COALESCE(e.offered_position, e.offer_position))
    ELSE 'EXTRA'
  END AS bid_position_name,
  NULLIF(BTRIM(e.real_position), '') AS operational_position_name,
  CASE
    WHEN e.presented_in_offer = true
      AND NULLIF(BTRIM(COALESCE(e.offered_position, e.offer_position)), '') IS NOT NULL
      THEN BTRIM(COALESCE(e.offered_position, e.offer_position))
    ELSE COALESCE(NULLIF(BTRIM(e.real_position), ''), 'SIN_DEFINIR')
  END AS document_rule_source,
  COALESCE(cpr.area_code, ma.code) AS area_code,
  e.municipality_id,
  e.institution_id,
  e.site_id,
  mm.id AS master_modality_id,
  NULLIF(BTRIM(e.modality), '') AS modality_name,
  NULLIF(BTRIM(e.workday_type), '') AS workday_type,
  COALESCE(e.presented_in_offer, false),
  CASE
    WHEN e.presented_in_offer = true THEN 'LICITACION'
    ELSE 'EXTRA'
  END AS staffing_type,
  COALESCE(cpr.counts_for_coverage, false) OR e.coverage_start_date IS NOT NULL,
  false,
  COALESCE(e.start_date, e.coverage_start_date),
  COALESCE(NULLIF(BTRIM(e.status), ''), 'ACTIVO'),
  COALESCE(UPPER(BTRIM(e.status)), 'ACTIVO') NOT IN ('RETIRADO', 'INACTIVO')
FROM employees e
LEFT JOIN master_modalities mm
  ON NULLIF(BTRIM(e.modality), '') IS NOT NULL
 AND UPPER(BTRIM(e.modality)) <> 'N/A'
 AND UPPER(BTRIM(mm.code)) = UPPER(BTRIM(e.modality))
LEFT JOIN LATERAL (
  SELECT mp1.*
  FROM master_positions mp1
  WHERE (
      e.presented_in_offer = true
      AND NULLIF(BTRIM(COALESCE(e.offered_position, e.offer_position)), '') IS NOT NULL
      AND (
        UPPER(BTRIM(COALESCE(mp1.bid_position_name, ''))) = UPPER(BTRIM(COALESCE(e.offered_position, e.offer_position)))
        OR UPPER(BTRIM(mp1.document_rule_source)) = UPPER(BTRIM(COALESCE(e.offered_position, e.offer_position)))
      )
    )
    OR (
      COALESCE(e.presented_in_offer, false) = false
      AND NULLIF(BTRIM(e.real_position), '') IS NOT NULL
      AND (
        UPPER(BTRIM(COALESCE(mp1.operational_position_name, ''))) = UPPER(BTRIM(e.real_position))
        OR UPPER(BTRIM(mp1.document_rule_source)) = UPPER(BTRIM(e.real_position))
      )
    )
  ORDER BY mp1.id
  LIMIT 1
) mp ON true
LEFT JOIN master_areas ma
  ON mp.area IS NOT NULL
 AND (
   UPPER(BTRIM(ma.code)) = UPPER(BTRIM(mp.area))
   OR UPPER(BTRIM(ma.name)) = UPPER(BTRIM(mp.area))
 )
LEFT JOIN LATERAL (
  SELECT cpr1.*
  FROM contract_position_rules cpr1
  WHERE cpr1.contract_id = e.contract_id
    AND cpr1.active = true
    AND (
      (
        e.presented_in_offer = true
        AND NULLIF(BTRIM(COALESCE(e.offered_position, e.offer_position)), '') IS NOT NULL
        AND UPPER(BTRIM(cpr1.document_rule_source)) = UPPER(BTRIM(COALESCE(e.offered_position, e.offer_position)))
      )
      OR (
        COALESCE(e.presented_in_offer, false) = false
        AND NULLIF(BTRIM(e.real_position), '') IS NOT NULL
        AND (
          UPPER(BTRIM(cpr1.document_rule_source)) = UPPER(BTRIM(e.real_position))
          OR UPPER(BTRIM(COALESCE(cpr1.operational_position_name, ''))) = UPPER(BTRIM(e.real_position))
          OR UPPER(BTRIM(cpr1.name)) = UPPER(BTRIM(e.real_position))
        )
      )
    )
  ORDER BY cpr1.id
  LIMIT 1
) cpr ON true
WHERE e.company_id IS NOT NULL
  AND e.contract_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM employee_contract_assignments eca
    WHERE eca.employee_id = e.id
      AND eca.contract_id = e.contract_id
      AND eca.active = true
      AND eca.assignment_end_date IS NULL
  );

INSERT INTO employee_assignment_municipalities (
  assignment_id,
  municipality_id,
  is_primary,
  active
)
SELECT
  eca.id,
  eca.municipality_id,
  true,
  true
FROM employee_contract_assignments eca
WHERE eca.municipality_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM employee_assignment_municipalities eam
    WHERE eam.assignment_id = eca.id
      AND eam.municipality_id = eca.municipality_id
  );

UPDATE employee_documents ed
SET employee_assignment_id = eca.id
FROM employees e
JOIN employee_contract_assignments eca
  ON eca.employee_id = e.id
 AND eca.company_id = e.company_id
 AND eca.contract_id = e.contract_id
 AND eca.active = true
 AND eca.assignment_end_date IS NULL
WHERE ed.employee_id = e.id
  AND ed.employee_assignment_id IS NULL;

INSERT INTO employee_assignment_history (
  assignment_id,
  employee_id,
  company_id,
  contract_id,
  action_type,
  field_name,
  new_value,
  snapshot_after,
  notes
)
SELECT
  eca.id,
  eca.employee_id,
  eca.company_id,
  eca.contract_id,
  'MIGRATED',
  'initial_assignment',
  jsonb_build_object(
    'staffing_type', eca.staffing_type,
    'bid_position_name', eca.bid_position_name,
    'operational_position_name', eca.operational_position_name,
    'document_rule_source', eca.document_rule_source,
    'municipality_id', eca.municipality_id,
    'institution_id', eca.institution_id,
    'site_id', eca.site_id,
    'modality_name', eca.modality_name,
    'workday_type', eca.workday_type,
    'status', eca.status
  ),
  jsonb_build_object(
    'assignment_id', eca.id,
    'employee_id', eca.employee_id,
    'company_id', eca.company_id,
    'contract_id', eca.contract_id,
    'contract_position_rule_id', eca.contract_position_rule_id,
    'master_position_id', eca.master_position_id,
    'bid_position_name', eca.bid_position_name,
    'operational_position_name', eca.operational_position_name,
    'document_rule_source', eca.document_rule_source,
    'area_code', eca.area_code,
    'municipality_id', eca.municipality_id,
    'institution_id', eca.institution_id,
    'site_id', eca.site_id,
    'master_modality_id', eca.master_modality_id,
    'modality_name', eca.modality_name,
    'workday_type', eca.workday_type,
    'presented_in_bid', eca.presented_in_bid,
    'staffing_type', eca.staffing_type,
    'coverage_enabled', eca.coverage_enabled,
    'assignment_start_date', eca.assignment_start_date,
    'status', eca.status,
    'active', eca.active
  ),
  'Sincronizacion incremental desde legado.'
FROM employee_contract_assignments eca
WHERE NOT EXISTS (
  SELECT 1
  FROM employee_assignment_history eah
  WHERE eah.assignment_id = eca.id
    AND eah.action_type = 'MIGRATED'
);

COMMENT ON COLUMN employee_documents.employee_assignment_id IS
  'Se llena de forma segura con la asignacion contractual activa del snapshot actual del empleado. El historico documental previo puede requerir conciliacion manual si el legado no guarda contrato por documento.';
