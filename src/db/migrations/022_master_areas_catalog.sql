-- =====================================================================
-- Catalogo maestro corporativo de areas para Talento Humano y operacion.
-- Normaliza las areas oficiales EMPIRIA sin romper las tablas actuales.
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

CREATE TABLE IF NOT EXISTS master_areas (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE master_areas
  ADD COLUMN IF NOT EXISTS code        TEXT,
  ADD COLUMN IF NOT EXISTS name        TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS active      BOOLEAN,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE master_areas
  ALTER COLUMN code TYPE TEXT USING code::text,
  ALTER COLUMN name TYPE TEXT USING name::text,
  ALTER COLUMN description TYPE TEXT USING description::text;

UPDATE master_areas
SET
  code = NULLIF(UPPER(BTRIM(code)), ''),
  name = NULLIF(BTRIM(name), ''),
  description = NULLIF(BTRIM(description), '');

UPDATE master_areas
SET code = 'AREA-' || id::text
WHERE code IS NULL;

UPDATE master_areas
SET name = code
WHERE name IS NULL;

WITH ranked_codes AS (
  SELECT
    id,
    code,
    ROW_NUMBER() OVER (PARTITION BY code ORDER BY id) AS rn
  FROM master_areas
)
UPDATE master_areas ma
SET code = ranked_codes.code || '-' || ranked_codes.rn::text
FROM ranked_codes
WHERE ma.id = ranked_codes.id
  AND ranked_codes.rn > 1;

WITH ranked_names AS (
  SELECT
    id,
    name,
    ROW_NUMBER() OVER (PARTITION BY UPPER(name) ORDER BY id) AS rn
  FROM master_areas
)
UPDATE master_areas ma
SET name = ranked_names.name || ' ' || ranked_names.rn::text
FROM ranked_names
WHERE ma.id = ranked_names.id
  AND ranked_names.rn > 1;

UPDATE master_areas
SET
  active = COALESCE(active, true),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, created_at, NOW());

ALTER TABLE master_areas
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN active SET DEFAULT true,
  ALTER COLUMN active SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE master_areas DROP CONSTRAINT IF EXISTS master_areas_code_not_blank_ck;
ALTER TABLE master_areas DROP CONSTRAINT IF EXISTS master_areas_name_not_blank_ck;

ALTER TABLE master_areas
  ADD CONSTRAINT master_areas_code_not_blank_ck
    CHECK (BTRIM(code) <> ''),
  ADD CONSTRAINT master_areas_name_not_blank_ck
    CHECK (BTRIM(name) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS master_areas_code_uk
  ON master_areas (code);

CREATE UNIQUE INDEX IF NOT EXISTS master_areas_name_uk
  ON master_areas (name);

CREATE INDEX IF NOT EXISTS master_areas_active_idx
  ON master_areas (active);

-- Estos indices dejan listas las tablas para futuras relaciones o joins
-- por area, sin imponer todavia una FK que rompa valores historicos.
CREATE INDEX IF NOT EXISTS master_positions_area_idx
  ON master_positions (area);

CREATE INDEX IF NOT EXISTS positions_area_idx
  ON positions (area);

DROP TRIGGER IF EXISTS master_areas_updated_at ON master_areas;
CREATE TRIGGER master_areas_updated_at
  BEFORE UPDATE ON master_areas
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE master_areas IS
  'Catalogo maestro corporativo de areas oficiales EMPIRIA para normalizar cargos, permisos, reportes, nomina y operacion.';

COMMENT ON COLUMN master_areas.code IS
  'Codigo unico del area maestra. Preparado para futuras relaciones desde catalogos y modulos operativos.';

COMMENT ON COLUMN master_areas.name IS
  'Nombre oficial y canonico del area EMPIRIA.';

COMMENT ON COLUMN master_areas.description IS
  'Descripcion corta del uso principal del area.';

COMMENT ON COLUMN master_positions.area IS
  'Area del cargo maestro. Se mantiene compatible como texto y queda preparada para futura normalizacion contra master_areas.code.';

COMMENT ON COLUMN positions.area IS
  'Area operativa del cargo por empresa/contrato. Se mantiene como texto por compatibilidad y queda lista para futura normalizacion.';

WITH official_areas(code, name, description) AS (
  VALUES
    ('OAL', 'Operación Alimentaria', 'Manipuladores'),
    ('CAL', 'Calidad', 'Supervisión y calidad'),
    ('LOG', 'Logística', 'Bodega y transporte'),
    ('OTE', 'Operación Territorial', 'Coordinadores zona y auxiliares PAE'),
    ('TH',  'TH', 'Talento humano'),
    ('SST', 'SST', 'Seguridad y salud'),
    ('ADM', 'Administrativo', 'Auxiliares administrativos'),
    ('GER', 'Gerencia', 'Directivos'),
    ('SGE', 'Servicios Generales', 'Aseo/mantenimiento'),
    ('FAC', 'Facturación', 'Facturación')
)
UPDATE master_areas ma
SET
  code = oa.code,
  name = oa.name,
  description = oa.description,
  active = true
FROM official_areas oa
WHERE UPPER(BTRIM(ma.code)) = oa.code
   OR UPPER(BTRIM(ma.name)) = UPPER(oa.name);

INSERT INTO master_areas (
  code,
  name,
  description,
  active
)
SELECT
  oa.code,
  oa.name,
  oa.description,
  true
FROM (
  VALUES
    ('OAL', 'Operación Alimentaria', 'Manipuladores'),
    ('CAL', 'Calidad', 'Supervisión y calidad'),
    ('LOG', 'Logística', 'Bodega y transporte'),
    ('OTE', 'Operación Territorial', 'Coordinadores zona y auxiliares PAE'),
    ('TH',  'TH', 'Talento humano'),
    ('SST', 'SST', 'Seguridad y salud'),
    ('ADM', 'Administrativo', 'Auxiliares administrativos'),
    ('GER', 'Gerencia', 'Directivos'),
    ('SGE', 'Servicios Generales', 'Aseo/mantenimiento'),
    ('FAC', 'Facturación', 'Facturación')
) AS oa(code, name, description)
WHERE NOT EXISTS (
  SELECT 1
  FROM master_areas ma
  WHERE UPPER(BTRIM(ma.code)) = oa.code
     OR UPPER(BTRIM(ma.name)) = UPPER(oa.name)
);
