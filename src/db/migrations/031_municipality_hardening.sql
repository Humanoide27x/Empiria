-- =============================================================================
-- EMPIRIA 031 — Hardening de municipios
-- FK constraints, índices de rendimiento, unicidad de normalized_name
-- =============================================================================

-- ── 1. FK: employees.municipality_id → municipalities.id ─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_employees_municipality'
      AND table_name      = 'employees'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT fk_employees_municipality
      FOREIGN KEY (municipality_id)
      REFERENCES municipalities(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── 2. FK: institutions.municipality_id → municipalities.id ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_institutions_municipality'
      AND table_name      = 'institutions'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE institutions
      ADD CONSTRAINT fk_institutions_municipality
      FOREIGN KEY (municipality_id)
      REFERENCES municipalities(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. Índice: employees(municipality_id) ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_employees_municipality_id
  ON employees (municipality_id);

-- ── 4. Índice: institutions(municipality_id) ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_institutions_municipality_id
  ON institutions (municipality_id);

-- ── 5. Índice: educational_sites(institution_id) ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_educational_sites_institution_id
  ON educational_sites (institution_id);

-- ── 6. Unicidad de normalized_name para bloquear municipios duplicados ────────
-- Primero asegurarse de que normalized_name esté poblado (por si 030 no se ejecutó).
UPDATE municipalities
SET normalized_name =
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      translate(
        UPPER(TRIM(name)),
        'ÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ',
        'AAAAAAEEEEIIIIOOOOOOUUUUYNC'
      ),
      '[^A-Z0-9 ]', '', 'g'
    ),
    '[[:space:]]+', ' ', 'g'
  )
WHERE normalized_name IS NULL OR normalized_name = '';

-- Agregar restricción UNIQUE solo si no existe ya.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'uq_municipalities_normalized_name'
      AND table_name      = 'municipalities'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE municipalities
      ADD CONSTRAINT uq_municipalities_normalized_name
      UNIQUE (normalized_name);
  END IF;
END $$;
