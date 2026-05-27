-- =============================================================================
-- EMPIRIA 032 - Municipality catalog hardening
-- Canonical municipalities by municipality_id, duplicate merge, FK/index cleanup
-- =============================================================================

ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS normalized_name TEXT;

-- Canonical normalization aligned with src/utils/municipality.js
UPDATE municipalities
SET normalized_name = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        translate(
          TRIM(COALESCE(name, '')),
          'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿÑñÇç',
          'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuYyyNnCc'
        ),
        '[[:cntrl:]]', '', 'g'
      ),
      '[^a-zA-Z0-9 ]', '', 'g'
    ),
    '[[:space:]]+', ' ', 'g'
  )
)
WHERE TRUE;

UPDATE municipalities
SET search_alias = normalized_name
WHERE COALESCE(search_alias, '') <> normalized_name;

DROP TABLE IF EXISTS _municipality_duplicates;
CREATE TEMP TABLE _municipality_duplicates AS
WITH grouped AS (
  SELECT
    normalized_name,
    MIN(id) AS canonical_id,
    ARRAY_AGG(id ORDER BY id) AS municipality_ids
  FROM municipalities
  WHERE NULLIF(TRIM(COALESCE(normalized_name, '')), '') IS NOT NULL
  GROUP BY normalized_name
  HAVING COUNT(*) > 1
)
SELECT
  grouped.normalized_name,
  grouped.canonical_id,
  duplicate_id
FROM grouped
CROSS JOIN LATERAL UNNEST(grouped.municipality_ids) AS duplicate_id
WHERE duplicate_id <> grouped.canonical_id;

-- Move all foreign references to the canonical municipality_id before deleting duplicates.
UPDATE employees e
SET municipality_id = d.canonical_id
FROM _municipality_duplicates d
WHERE e.municipality_id = d.duplicate_id;

UPDATE coverage_upload_rows cur
SET municipality_id = d.canonical_id
FROM _municipality_duplicates d
WHERE cur.municipality_id = d.duplicate_id;

UPDATE institutions i
SET municipality_id = d.canonical_id
FROM _municipality_duplicates d
WHERE i.municipality_id = d.duplicate_id;

DO $$
BEGIN
  IF to_regclass('public.payroll_groups') IS NOT NULL THEN
    EXECUTE '
      UPDATE payroll_groups pg
      SET municipality_id = d.canonical_id
      FROM _municipality_duplicates d
      WHERE pg.municipality_id = d.duplicate_id
    ';
  END IF;

  IF to_regclass('public.payroll_novelties') IS NOT NULL THEN
    EXECUTE '
      UPDATE payroll_novelties pn
      SET municipality_id = d.canonical_id
      FROM _municipality_duplicates d
      WHERE pn.municipality_id = d.duplicate_id
    ';
  END IF;

  IF to_regclass('public.external_turn_workers') IS NOT NULL THEN
    EXECUTE '
      UPDATE external_turn_workers etw
      SET municipality_id = d.canonical_id
      FROM _municipality_duplicates d
      WHERE etw.municipality_id = d.duplicate_id
    ';
  END IF;

  IF to_regclass('public.novelty_supports') IS NOT NULL THEN
    EXECUTE '
      UPDATE novelty_supports ns
      SET municipality_id = d.canonical_id
      FROM _municipality_duplicates d
      WHERE ns.municipality_id = d.duplicate_id
    ';
  END IF;
END $$;

DELETE FROM municipalities m
USING _municipality_duplicates d
WHERE m.id = d.duplicate_id;

-- Resolve municipality_id from legacy municipality text where still possible.
UPDATE coverage_upload_rows cur
SET municipality_id = m.id
FROM municipalities m
WHERE cur.municipality_id IS NULL
  AND NULLIF(TRIM(COALESCE(cur.municipality, '')), '') IS NOT NULL
  AND m.normalized_name = LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          translate(
            TRIM(COALESCE(cur.municipality, '')),
            'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿÑñÇç',
            'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuYyyNnCc'
          ),
          '[[:cntrl:]]', '', 'g'
        ),
        '[^a-zA-Z0-9 ]', '', 'g'
      ),
      '[[:space:]]+', ' ', 'g'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'uq_municipalities_normalized_name'
      AND table_name = 'municipalities'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE municipalities
      ADD CONSTRAINT uq_municipalities_normalized_name UNIQUE (normalized_name);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.coverage_upload_rows') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_coverage_upload_rows_municipality'
      AND table_name = 'coverage_upload_rows'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE coverage_upload_rows
      ADD CONSTRAINT fk_coverage_upload_rows_municipality
      FOREIGN KEY (municipality_id)
      REFERENCES municipalities(id)
      ON DELETE SET NULL;
  END IF;

  IF to_regclass('public.payroll_groups') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_payroll_groups_municipality'
      AND table_name = 'payroll_groups'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE payroll_groups
      ADD CONSTRAINT fk_payroll_groups_municipality
      FOREIGN KEY (municipality_id)
      REFERENCES municipalities(id)
      ON DELETE SET NULL;
  END IF;

  IF to_regclass('public.payroll_novelties') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_payroll_novelties_municipality'
      AND table_name = 'payroll_novelties'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE payroll_novelties
      ADD CONSTRAINT fk_payroll_novelties_municipality
      FOREIGN KEY (municipality_id)
      REFERENCES municipalities(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_municipalities_normalized_name_v2
  ON municipalities (normalized_name);
CREATE INDEX IF NOT EXISTS idx_employees_municipality_id_v2
  ON employees (municipality_id);
CREATE INDEX IF NOT EXISTS idx_coverage_upload_rows_municipality_id_v2
  ON coverage_upload_rows (municipality_id);
CREATE INDEX IF NOT EXISTS idx_institutions_municipality_id_v2
  ON institutions (municipality_id);
CREATE INDEX IF NOT EXISTS idx_educational_sites_institution_id_v2
  ON educational_sites (institution_id);

DO $$
BEGIN
  IF to_regclass('public.payroll_groups') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_payroll_groups_municipality_id_v2 ON payroll_groups (municipality_id)';
  END IF;
  IF to_regclass('public.payroll_novelties') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_payroll_novelties_municipality_id_v2 ON payroll_novelties (municipality_id)';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM employees WHERE municipality_id IS NULL) THEN
    ALTER TABLE employees
      ALTER COLUMN municipality_id SET NOT NULL;
  END IF;
END $$;
