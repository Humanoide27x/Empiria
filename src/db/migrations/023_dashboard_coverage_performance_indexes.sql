DO $$
BEGIN
  IF to_regclass('public.employees') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employees'
        AND column_name IN (
          'company_id',
          'contract_id',
          'municipality_id',
          'institution_id',
          'site_id',
          'status',
          'real_position',
          'workday_type'
        )
      GROUP BY table_name
      HAVING COUNT(*) = 8
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_employees_coverage_live_counts
        ON employees (
          company_id,
          contract_id,
          municipality_id,
          institution_id,
          site_id,
          status,
          real_position,
          workday_type
        );
    END IF;
  END IF;

  IF to_regclass('public.coverage_upload_rows') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_coverage_upload_rows_upload_location
      ON coverage_upload_rows(upload_id, municipality, institution, site, modality);
  END IF;

  IF to_regclass('public.coverage_uploads') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_coverage_uploads_period_created
      ON coverage_uploads(company_id, contract_id, period_month, created_at DESC, id DESC);
  END IF;
END $$;
