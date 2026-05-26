-- Enterprise summary views for dashboard and alert workloads.
-- They are intentionally read-only and can be promoted to materialized
-- views if the deployment adds a refresh job.

CREATE OR REPLACE VIEW employee_document_status_summary AS
SELECT
  e.company_id,
  e.contract_id,
  e.id AS employee_id,
  COUNT(ed.id)::int AS total_documents,
  COUNT(*) FILTER (WHERE ed.status = 'aprobado')::int AS approved_documents,
  COUNT(*) FILTER (WHERE ed.status = 'rechazado')::int AS rejected_documents,
  COUNT(*) FILTER (WHERE ed.status IN ('pendiente', 'cargado'))::int AS pending_documents,
  COUNT(*) FILTER (
    WHERE ed.expiration_date IS NOT NULL
      AND ed.expiration_date < CURRENT_DATE
  )::int AS expired_documents,
  COUNT(*) FILTER (
    WHERE ed.expiration_date IS NOT NULL
      AND ed.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
  )::int AS expiring_30d_documents
FROM employees e
LEFT JOIN employee_documents ed
  ON ed.employee_id = e.id
GROUP BY e.company_id, e.contract_id, e.id;

COMMENT ON VIEW employee_document_status_summary IS
  'Resumen documental por empleado para alertas y widgets de cumplimiento.';

CREATE OR REPLACE VIEW coverage_summary AS
WITH latest_upload AS (
  SELECT DISTINCT ON (company_id, contract_id)
    id,
    company_id,
    contract_id,
    period_month,
    created_at
  FROM coverage_uploads
  ORDER BY company_id, contract_id, created_at DESC, id DESC
)
SELECT
  lu.company_id,
  lu.contract_id,
  lu.period_month,
  m.id AS municipality_id,
  COALESCE(m.name, TRIM(r.municipality)) AS municipality_name,
  COALESCE(SUM(r.required_tc), 0)::int AS required_tc,
  COALESCE(SUM(r.required_mt), 0)::int AS required_mt,
  (COALESCE(SUM(r.required_tc), 0) + COALESCE(SUM(r.required_mt), 0))::int AS required_total,
  MAX(lu.created_at) AS source_created_at
FROM latest_upload lu
JOIN coverage_upload_rows r
  ON r.upload_id = lu.id
LEFT JOIN municipalities m
  ON LOWER(TRIM(m.name)) = LOWER(TRIM(r.municipality))
GROUP BY lu.company_id, lu.contract_id, lu.period_month, m.id, COALESCE(m.name, TRIM(r.municipality));

COMMENT ON VIEW coverage_summary IS
  'Resumen de cobertura por municipio sobre la carga más reciente por empresa y contrato.';

CREATE OR REPLACE VIEW dashboard_summary_monthly AS
SELECT
  e.company_id,
  e.contract_id,
  TO_CHAR(
    COALESCE(e.coverage_start_date, e.start_date, e.created_at::date),
    'YYYY-MM'
  ) AS period_month,
  COUNT(*)::int AS total_employees,
  COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status, ''))) = 'ACTIVO')::int AS active_employees,
  COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.status, ''))) = 'INACTIVO')::int AS inactive_employees,
  COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.workday_type, ''))) = 'TC')::int AS tc_count,
  COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e.workday_type, ''))) = 'MT')::int AS mt_count
FROM employees e
GROUP BY
  e.company_id,
  e.contract_id,
  TO_CHAR(COALESCE(e.coverage_start_date, e.start_date, e.created_at::date), 'YYYY-MM');

COMMENT ON VIEW dashboard_summary_monthly IS
  'Base mensual para KPIs de dashboard y snapshots rápidos por empresa/contrato.';
