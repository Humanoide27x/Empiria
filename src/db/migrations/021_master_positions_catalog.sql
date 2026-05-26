-- =====================================================================
-- Catalogo maestro corporativo de cargos para Talento Humano.
-- Separa el cargo de licitacion del cargo operativo real sin tocar
-- las tablas operativas actuales (positions, employees, document_types).
-- =====================================================================

-- Reutiliza la misma funcion de updated_at usada por otras migraciones.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS master_positions (
  id                        SERIAL PRIMARY KEY,
  code                      TEXT NOT NULL,
  bid_position_name         TEXT,
  operational_position_name TEXT,
  document_rule_source      TEXT NOT NULL,
  category                  TEXT,
  area                      TEXT,
  counts_for_coverage       BOOLEAN NOT NULL DEFAULT false,
  risk_level                TEXT,
  active                    BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE master_positions
  ADD COLUMN IF NOT EXISTS code                      TEXT,
  ADD COLUMN IF NOT EXISTS bid_position_name         TEXT,
  ADD COLUMN IF NOT EXISTS operational_position_name TEXT,
  ADD COLUMN IF NOT EXISTS document_rule_source      TEXT,
  ADD COLUMN IF NOT EXISTS category                  TEXT,
  ADD COLUMN IF NOT EXISTS area                      TEXT,
  ADD COLUMN IF NOT EXISTS counts_for_coverage       BOOLEAN,
  ADD COLUMN IF NOT EXISTS risk_level                TEXT,
  ADD COLUMN IF NOT EXISTS active                    BOOLEAN,
  ADD COLUMN IF NOT EXISTS created_at                TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at                TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE master_positions
  ALTER COLUMN code TYPE TEXT USING code::text,
  ALTER COLUMN bid_position_name TYPE TEXT USING bid_position_name::text,
  ALTER COLUMN operational_position_name TYPE TEXT USING operational_position_name::text,
  ALTER COLUMN document_rule_source TYPE TEXT USING document_rule_source::text,
  ALTER COLUMN category TYPE TEXT USING category::text,
  ALTER COLUMN area TYPE TEXT USING area::text,
  ALTER COLUMN risk_level TYPE TEXT USING risk_level::text;

-- Normaliza cadenas y rellena los campos nuevos sin borrar ningun registro.
UPDATE master_positions
SET
  code = NULLIF(UPPER(BTRIM(code)), ''),
  bid_position_name = NULLIF(BTRIM(bid_position_name), ''),
  operational_position_name = NULLIF(BTRIM(operational_position_name), ''),
  document_rule_source = NULLIF(BTRIM(document_rule_source), ''),
  category = NULLIF(BTRIM(category), ''),
  area = NULLIF(BTRIM(area), ''),
  risk_level = NULLIF(BTRIM(risk_level), '');

UPDATE master_positions
SET code = 'MP-' || id::text
WHERE code IS NULL;

-- Si existen codigos repetidos, se conservan todos y se desambiguan
-- antes de crear la restriccion unica.
WITH ranked_codes AS (
  SELECT
    id,
    code,
    ROW_NUMBER() OVER (PARTITION BY code ORDER BY id) AS rn
  FROM master_positions
)
UPDATE master_positions mp
SET code = ranked_codes.code || '-' || ranked_codes.rn::text
FROM ranked_codes
WHERE mp.id = ranked_codes.id
  AND ranked_codes.rn > 1;

-- El caso EXTRA siempre debe terminar con una referencia operativa valida.
UPDATE master_positions
SET operational_position_name = COALESCE(
  NULLIF(BTRIM(operational_position_name), ''),
  NULLIF(BTRIM(document_rule_source), ''),
  code
)
WHERE UPPER(COALESCE(BTRIM(bid_position_name), '')) = 'EXTRA'
  AND NULLIF(BTRIM(operational_position_name), '') IS NULL;

UPDATE master_positions
SET document_rule_source = CASE
  WHEN UPPER(COALESCE(BTRIM(bid_position_name), '')) = 'EXTRA' THEN
    COALESCE(
      NULLIF(BTRIM(operational_position_name), ''),
      NULLIF(BTRIM(document_rule_source), ''),
      code
    )
  ELSE
    COALESCE(
      NULLIF(BTRIM(document_rule_source), ''),
      NULLIF(BTRIM(bid_position_name), ''),
      NULLIF(BTRIM(operational_position_name), ''),
      code
    )
END
WHERE NULLIF(BTRIM(document_rule_source), '') IS NULL
   OR UPPER(COALESCE(BTRIM(bid_position_name), '')) = 'EXTRA';

UPDATE master_positions
SET
  counts_for_coverage = COALESCE(counts_for_coverage, false),
  active = COALESCE(active, true),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, created_at, NOW());

ALTER TABLE master_positions
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN bid_position_name DROP NOT NULL,
  ALTER COLUMN operational_position_name DROP NOT NULL,
  ALTER COLUMN document_rule_source SET NOT NULL,
  ALTER COLUMN counts_for_coverage SET DEFAULT false,
  ALTER COLUMN counts_for_coverage SET NOT NULL,
  ALTER COLUMN active SET DEFAULT true,
  ALTER COLUMN active SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE master_positions DROP CONSTRAINT IF EXISTS master_positions_code_not_blank_ck;
ALTER TABLE master_positions DROP CONSTRAINT IF EXISTS master_positions_document_rule_source_not_blank_ck;
ALTER TABLE master_positions DROP CONSTRAINT IF EXISTS master_positions_extra_requires_operational_ck;
ALTER TABLE master_positions DROP CONSTRAINT IF EXISTS master_positions_extra_rule_source_matches_operational_ck;

ALTER TABLE master_positions
  ADD CONSTRAINT master_positions_code_not_blank_ck
    CHECK (BTRIM(code) <> ''),
  ADD CONSTRAINT master_positions_document_rule_source_not_blank_ck
    CHECK (BTRIM(document_rule_source) <> ''),
  ADD CONSTRAINT master_positions_extra_requires_operational_ck
    CHECK (
      UPPER(COALESCE(BTRIM(bid_position_name), '')) <> 'EXTRA'
      OR NULLIF(BTRIM(operational_position_name), '') IS NOT NULL
    ),
  ADD CONSTRAINT master_positions_extra_rule_source_matches_operational_ck
    CHECK (
      UPPER(COALESCE(BTRIM(bid_position_name), '')) <> 'EXTRA'
      OR UPPER(BTRIM(document_rule_source)) = UPPER(BTRIM(operational_position_name))
    );

CREATE UNIQUE INDEX IF NOT EXISTS master_positions_code_uk
  ON master_positions (code);

DROP TRIGGER IF EXISTS master_positions_updated_at ON master_positions;
CREATE TRIGGER master_positions_updated_at
  BEFORE UPDATE ON master_positions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE master_positions IS
  'Catalogo maestro corporativo de cargos. Separa el cargo de licitacion del cargo operativo real.';

COMMENT ON COLUMN master_positions.code IS
  'Codigo corporativo unico del cargo maestro.';

COMMENT ON COLUMN master_positions.bid_position_name IS
  'Cargo presentado en licitacion. Puede ser nulo o usar EXTRA para personal interno/no presentado.';

COMMENT ON COLUMN master_positions.operational_position_name IS
  'Cargo operativo o funcion interna real. Debe existir cuando bid_position_name = EXTRA.';

COMMENT ON COLUMN master_positions.document_rule_source IS
  'Cargo que gobierna documentos, requisitos, experiencia y validaciones del pliego.';

COMMENT ON COLUMN master_positions.area IS
  'Area interna oficial EMPIRIA. No agrega tenant_id porque es un catalogo maestro corporativo.';

COMMENT ON COLUMN master_positions.counts_for_coverage IS
  'Indica si el cargo cuenta para cobertura operativa.';

-- Seed inicial. Si el codigo ya existe, se actualiza sin crear duplicados.
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
VALUES
  (
    'OMA',
    'Operario Manipulador de Alimentos',
    'Operario Manipulador de Alimentos',
    'Operario Manipulador de Alimentos',
    'Operativo',
    'Operación Alimentaria',
    true,
    'Alto',
    true
  ),
  (
    'CZO',
    'Coordinador de Zona',
    NULL,
    'Coordinador de Zona',
    'Supervisión',
    'Operación Territorial',
    false,
    'Medio',
    true
  ),
  (
    'SUP',
    'Supervisor de Calidad',
    'Supervisor PAE',
    'Supervisor de Calidad',
    'Supervisión',
    'Calidad',
    false,
    'Medio',
    true
  ),
  (
    'AUX',
    'Auxiliar Administrativo',
    NULL,
    'Auxiliar Administrativo',
    'Administrativo',
    'Administrativo',
    false,
    'Medio',
    true
  ),
  (
    'BOD',
    'Operario de Bodega, Auxiliares y Transportadores',
    'Auxiliar de Bodega',
    'Operario de Bodega, Auxiliares y Transportadores',
    'Operativo',
    'Logística',
    false,
    'Medio',
    true
  ),
  (
    'CSU',
    'Coordinador de Suministro',
    NULL,
    'Coordinador de Suministro',
    'Supervisión',
    'Operación Territorial',
    false,
    'Medio',
    true
  )
ON CONFLICT (code) DO UPDATE
SET
  bid_position_name = EXCLUDED.bid_position_name,
  operational_position_name = EXCLUDED.operational_position_name,
  document_rule_source = EXCLUDED.document_rule_source,
  category = EXCLUDED.category,
  area = EXCLUDED.area,
  counts_for_coverage = EXCLUDED.counts_for_coverage,
  risk_level = EXCLUDED.risk_level,
  active = EXCLUDED.active;
