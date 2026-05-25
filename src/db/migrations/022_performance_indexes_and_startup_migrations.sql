ALTER TABLE IF EXISTS employees
  ADD COLUMN IF NOT EXISTS municipios_a_cargo TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS normalized_full_name TEXT,
  ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS account_number TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS auxiliar_gestor_zona TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS contract_type TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS uniforme TEXT,
  ADD COLUMN IF NOT EXISTS calzado TEXT,
  ADD COLUMN IF NOT EXISTS talla_camisa TEXT,
  ADD COLUMN IF NOT EXISTS talla_pantalon TEXT;

ALTER TABLE IF EXISTS contract_settings
  ADD COLUMN IF NOT EXISTS salary_config JSONB DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS municipality_ids INTEGER[] DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE IF EXISTS payroll_results
  ADD COLUMN IF NOT EXISTS dias_no_clase INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS novedades_detalle JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS adicionales_detalle JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS salary_snapshot JSONB NOT NULL DEFAULT '{}';

ALTER TABLE IF EXISTS employee_import_staging
  ADD COLUMN IF NOT EXISTS existing_employee_id INTEGER,
  ADD COLUMN IF NOT EXISTS conflicts JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF to_regclass('public.employee_import_staging') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'employee_import_staging_status_check'
    ) THEN
      ALTER TABLE employee_import_staging DROP CONSTRAINT employee_import_staging_status_check;
    END IF;

    ALTER TABLE employee_import_staging
      ADD CONSTRAINT employee_import_staging_status_check
      CHECK (status IN (
        'PENDING','VALID','ERROR','NEEDS_REVIEW','EXISTING_EMPLOYEE',
        'HAS_CONFLICTS','IMPORTED','UPDATED','SKIPPED'
      ));
  END IF;
END $$;

ALTER TABLE IF EXISTS dotacion_remisiones
  ADD COLUMN IF NOT EXISTS fecha_enviado DATE,
  ADD COLUMN IF NOT EXISTS fecha_recibido DATE,
  ADD COLUMN IF NOT EXISTS comprobante_enviado TEXT,
  ADD COLUMN IF NOT EXISTS comprobante_recibido TEXT;

DO $$
BEGIN
  IF to_regclass('public.employees') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_employees_status_company_contract
      ON employees(status, company_id, contract_id);

    CREATE INDEX IF NOT EXISTS idx_employees_company_contract_municipality
      ON employees(company_id, contract_id, municipality_id);

    CREATE INDEX IF NOT EXISTS idx_employees_document_lookup
      ON employees(document_type, document_number);

    CREATE INDEX IF NOT EXISTS idx_employees_company_updated
      ON employees(company_id, updated_at DESC, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_employees_company_status_updated
      ON employees(company_id, status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_employees_company_contract_name
      ON employees(company_id, contract_id, full_name, id);

    CREATE INDEX IF NOT EXISTS idx_employees_company_contract_status_name
      ON employees(company_id, contract_id, status, full_name, id);

    CREATE INDEX IF NOT EXISTS idx_employees_contract_municipality_name
      ON employees(contract_id, municipality_id, full_name, id);

    CREATE INDEX IF NOT EXISTS idx_employees_company_real_position
      ON employees(company_id, real_position);

    CREATE INDEX IF NOT EXISTS idx_employees_company_offered_position
      ON employees(company_id, offered_position);

    CREATE INDEX IF NOT EXISTS idx_employees_company_modality
      ON employees(company_id, modality);

    CREATE INDEX IF NOT EXISTS idx_employees_food_exam_expiry
      ON employees(status, company_id, food_handling_exam_expiry_date);
  END IF;

  IF to_regclass('public.employee_documents') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_master_uploaded
      ON employee_documents(employee_id, master_document_type_id, uploaded_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_employee_documents_assignment_master
      ON employee_documents(employee_assignment_id, master_document_type_id);

    CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_status
      ON employee_documents(employee_id, status);

    CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_status_expiration
      ON employee_documents(employee_id, status, expiration_date);

    CREATE INDEX IF NOT EXISTS idx_employee_documents_master_type
      ON employee_documents(master_document_type_id);

    CREATE INDEX IF NOT EXISTS idx_employee_documents_document_type
      ON employee_documents(document_type_id);
  END IF;

  IF to_regclass('public.document_types') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_document_types_master_document_type
      ON document_types(master_document_type_id);
  END IF;

  IF to_regclass('public.contract_position_documents') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_contract_position_documents_document_type
      ON contract_position_documents(document_type_id);
  END IF;

  IF to_regclass('public.employee_contract_assignments') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_employee_contract_assignments_employee_active
      ON employee_contract_assignments(employee_id, active, assignment_start_date DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_employee_contract_assignments_contract_active
      ON employee_contract_assignments(contract_id, active, contract_position_rule_id);
  END IF;

  IF to_regclass('public.contract_position_rules') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_contract_position_rules_contract_active
      ON contract_position_rules(contract_id, active, id);
  END IF;

  IF to_regclass('public.contract_document_rules') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_contract_document_rules_contract_matrix
      ON contract_document_rules(
        contract_id,
        contract_position_rule_id,
        master_document_type_id,
        applies_to_staffing_type
      );

    CREATE INDEX IF NOT EXISTS idx_contract_document_rules_contract_active
      ON contract_document_rules(contract_id, active, contract_position_rule_id);

    CREATE INDEX IF NOT EXISTS idx_contract_document_rules_master_document
      ON contract_document_rules(master_document_type_id);
  END IF;

  IF to_regclass('public.master_document_types') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_master_document_types_active_code
      ON master_document_types(active, code);
  END IF;

  IF to_regclass('public.contracts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_contracts_company_active
      ON contracts(company_id, active, id);
  END IF;

  IF to_regclass('public.municipalities') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_municipalities_name
      ON municipalities(name);
  END IF;

  IF to_regclass('public.coverage_uploads') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_coverage_uploads_created
      ON coverage_uploads(created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_coverage_uploads_company_contract_period
      ON coverage_uploads(company_id, contract_id, period_month);
  END IF;

  IF to_regclass('public.coverage_upload_rows') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_coverage_upload_rows_upload_municipality
      ON coverage_upload_rows(upload_id, municipality);
  END IF;

  IF to_regclass('public.payroll_novelties') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_payroll_novelties_company_status_created
      ON payroll_novelties(company_id, status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_payroll_novelties_created
      ON payroll_novelties(created_at DESC);
  END IF;

  IF to_regclass('public.calendar_events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_calendar_events_company_date
      ON calendar_events(company_id, event_date, event_time);
  END IF;
END $$;
