-- =============================================================================
-- EMPIRIA 030 — Normalización global de municipios
-- Fuente oficial: municipalities.id
-- Regla: nunca comparar municipios por texto si existe municipality_id
-- =============================================================================

-- ── 1. normalized_name en municipalities ─────────────────────────────────────
-- Nombre sin tildes, en mayúsculas, sin caracteres especiales ni dobles espacios.
-- Ejemplo: "PUERTO LÓPEZ" → "PUERTO LOPEZ"
ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS normalized_name TEXT;

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

CREATE INDEX IF NOT EXISTS idx_municipalities_normalized_name
  ON municipalities (normalized_name);

-- ── 2. municipality_id en coverage_upload_rows ────────────────────────────────
-- Permite JOIN directo por ID en vez de comparación de texto.
ALTER TABLE coverage_upload_rows
  ADD COLUMN IF NOT EXISTS municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coverage_rows_municipality_id
  ON coverage_upload_rows (municipality_id);

-- ── 3. Backfill municipality_id para filas existentes ─────────────────────────
-- Resuelve por normalized_name. Ignora filas cuyo municipio no exista en el catálogo.
UPDATE coverage_upload_rows cur
SET municipality_id = m.id
FROM municipalities m
WHERE cur.municipality_id IS NULL
  AND m.normalized_name IS NOT NULL
  AND m.normalized_name = REGEXP_REPLACE(
      REGEXP_REPLACE(
        translate(
          UPPER(TRIM(cur.municipality)),
          'ÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ',
          'AAAAAAEEEEIIIIOOOOOOUUUUYNC'
        ),
        '[^A-Z0-9 ]', '', 'g'
      ),
      '[[:space:]]+', ' ', 'g'
    );

-- ── 4. Vista diagnóstico: filas de cobertura sin municipio resuelto ───────────
-- Útil para identificar municipios del Excel que no existen en el catálogo oficial.
CREATE OR REPLACE VIEW v_coverage_unresolved_municipalities AS
SELECT DISTINCT
  cur.municipality AS municipality_text,
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      translate(UPPER(TRIM(cur.municipality)), 'ÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ', 'AAAAAAEEEEIIIIOOOOOOUUUUYNC'),
      '[^A-Z0-9 ]', '', 'g'
    ),
    '[[:space:]]+', ' ', 'g'
  ) AS normalized_text,
  COUNT(*) AS row_count
FROM coverage_upload_rows cur
WHERE cur.municipality_id IS NULL
  AND cur.municipality IS NOT NULL
  AND TRIM(cur.municipality) <> ''
GROUP BY cur.municipality
ORDER BY row_count DESC;

-- ── 5. Vista diagnóstico: empleados activos con municipality_id NULL ──────────
CREATE OR REPLACE VIEW v_employees_missing_municipality AS
SELECT
  e.id,
  e.full_name,
  e.document_number,
  e.real_position,
  e.status,
  e.contract_id,
  e.company_id
FROM employees e
WHERE e.municipality_id IS NULL
  AND UPPER(TRIM(COALESCE(e.status, ''))) NOT IN ('RETIRADO', 'RETIRADA', 'INACTIVO', 'INACTIVA')
ORDER BY e.full_name;
