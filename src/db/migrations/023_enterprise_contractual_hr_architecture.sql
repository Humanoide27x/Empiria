-- =====================================================================
-- Arquitectura enterprise contractual de Talento Humano para EMPIRIA.
-- Agrega catalogos maestros faltantes, reglas contractuales configurables,
-- asignaciones reutilizables, historial y trazabilidad sin romper la
-- operacion actual basada en employees, contract_positions y document_types.
-- =====================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION set_employee_experience_months()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  effective_end DATE;
  month_count NUMERIC;
BEGIN
  IF NEW.start_date IS NULL THEN
    NEW.months_calculated := 0;
    RETURN NEW;
  END IF;

  effective_end := COALESCE(NEW.end_date, CURRENT_DATE);
  IF effective_end < NEW.start_date THEN
    NEW.months_calculated := 0;
    RETURN NEW;
  END IF;

  month_count :=
    (DATE_PART('year', AGE(effective_end, NEW.start_date)) * 12)
    + DATE_PART('month', AGE(effective_end, NEW.start_date));

  NEW.months_calculated := GREATEST(COALESCE(month_count, 0), 0)::INTEGER;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- Catalogos maestros faltantes
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS master_document_types (
  id                 SERIAL PRIMARY KEY,
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT,
  phase              TEXT,
  is_global_base     BOOLEAN NOT NULL DEFAULT false,
  visible_to_auditor BOOLEAN NOT NULL DEFAULT false,
  active             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE master_document_types
  ADD COLUMN IF NOT EXISTS code               TEXT,
  ADD COLUMN IF NOT EXISTS name               TEXT,
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS phase              TEXT,
  ADD COLUMN IF NOT EXISTS is_global_base     BOOLEAN,
  ADD COLUMN IF NOT EXISTS visible_to_auditor BOOLEAN,
  ADD COLUMN IF NOT EXISTS active             BOOLEAN,
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();

UPDATE master_document_types
SET
  code = NULLIF(LOWER(BTRIM(code)), ''),
  name = NULLIF(BTRIM(name), ''),
  description = NULLIF(BTRIM(description), ''),
  phase = NULLIF(BTRIM(phase), '');

UPDATE master_document_types
SET code = 'mdt-' || id::TEXT
WHERE code IS NULL;

UPDATE master_document_types
SET name = UPPER(code)
WHERE name IS NULL;

WITH ranked_codes AS (
  SELECT id, code, ROW_NUMBER() OVER (PARTITION BY code ORDER BY id) AS rn
  FROM master_document_types
)
UPDATE master_document_types mdt
SET code = ranked_codes.code || '-' || ranked_codes.rn::TEXT
FROM ranked_codes
WHERE mdt.id = ranked_codes.id
  AND ranked_codes.rn > 1;

WITH ranked_names AS (
  SELECT id, name, ROW_NUMBER() OVER (PARTITION BY UPPER(name) ORDER BY id) AS rn
  FROM master_document_types
)
UPDATE master_document_types mdt
SET name = ranked_names.name || ' ' || ranked_names.rn::TEXT
FROM ranked_names
WHERE mdt.id = ranked_names.id
  AND ranked_names.rn > 1;

UPDATE master_document_types
SET
  is_global_base = COALESCE(is_global_base, false),
  visible_to_auditor = COALESCE(visible_to_auditor, false),
  active = COALESCE(active, true),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, created_at, NOW());

ALTER TABLE master_document_types
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN is_global_base SET DEFAULT false,
  ALTER COLUMN is_global_base SET NOT NULL,
  ALTER COLUMN visible_to_auditor SET DEFAULT false,
  ALTER COLUMN visible_to_auditor SET NOT NULL,
  ALTER COLUMN active SET DEFAULT true,
  ALTER COLUMN active SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE master_document_types DROP CONSTRAINT IF EXISTS master_document_types_code_not_blank_ck;
ALTER TABLE master_document_types DROP CONSTRAINT IF EXISTS master_document_types_name_not_blank_ck;

ALTER TABLE master_document_types
  ADD CONSTRAINT master_document_types_code_not_blank_ck CHECK (BTRIM(code) <> ''),
  ADD CONSTRAINT master_document_types_name_not_blank_ck CHECK (BTRIM(name) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS master_document_types_code_uk
  ON master_document_types (code);

CREATE UNIQUE INDEX IF NOT EXISTS master_document_types_name_uk
  ON master_document_types (name);

CREATE INDEX IF NOT EXISTS master_document_types_global_base_idx
  ON master_document_types (is_global_base, active);

DROP TRIGGER IF EXISTS master_document_types_updated_at ON master_document_types;
CREATE TRIGGER master_document_types_updated_at
  BEFORE UPDATE ON master_document_types
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE master_document_types IS
  'Catalogo maestro de documentos. Separa documentos base globales de documentos contractuales configurables.';

COMMENT ON COLUMN master_document_types.is_global_base IS
  'Indica si el documento aplica siempre, sin depender del contrato, cargo o modalidad.';

CREATE TABLE IF NOT EXISTS master_modalities (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE master_modalities
  ADD COLUMN IF NOT EXISTS code        TEXT,
  ADD COLUMN IF NOT EXISTS name        TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS active      BOOLEAN,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

UPDATE master_modalities
SET
  code = NULLIF(UPPER(BTRIM(code)), ''),
  name = NULLIF(BTRIM(name), ''),
  description = NULLIF(BTRIM(description), '');

UPDATE master_modalities
SET code = 'MOD-' || id::TEXT
WHERE code IS NULL;

UPDATE master_modalities
SET name = code
WHERE name IS NULL;

WITH ranked_codes AS (
  SELECT id, code, ROW_NUMBER() OVER (PARTITION BY code ORDER BY id) AS rn
  FROM master_modalities
)
UPDATE master_modalities mm
SET code = ranked_codes.code || '-' || ranked_codes.rn::TEXT
FROM ranked_codes
WHERE mm.id = ranked_codes.id
  AND ranked_codes.rn > 1;

WITH ranked_names AS (
  SELECT id, name, ROW_NUMBER() OVER (PARTITION BY UPPER(name) ORDER BY id) AS rn
  FROM master_modalities
)
UPDATE master_modalities mm
SET name = ranked_names.name || ' ' || ranked_names.rn::TEXT
FROM ranked_names
WHERE mm.id = ranked_names.id
  AND ranked_names.rn > 1;

UPDATE master_modalities
SET
  active = COALESCE(active, true),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, created_at, NOW());

ALTER TABLE master_modalities
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN active SET DEFAULT true,
  ALTER COLUMN active SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE master_modalities DROP CONSTRAINT IF EXISTS master_modalities_code_not_blank_ck;
ALTER TABLE master_modalities DROP CONSTRAINT IF EXISTS master_modalities_name_not_blank_ck;

ALTER TABLE master_modalities
  ADD CONSTRAINT master_modalities_code_not_blank_ck CHECK (BTRIM(code) <> ''),
  ADD CONSTRAINT master_modalities_name_not_blank_ck CHECK (BTRIM(name) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS master_modalities_code_uk
  ON master_modalities (code);

CREATE UNIQUE INDEX IF NOT EXISTS master_modalities_name_uk
  ON master_modalities (name);

CREATE INDEX IF NOT EXISTS master_modalities_active_idx
  ON master_modalities (active);

DROP TRIGGER IF EXISTS master_modalities_updated_at ON master_modalities;
CREATE TRIGGER master_modalities_updated_at
  BEFORE UPDATE ON master_modalities
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE master_modalities IS
  'Catalogo maestro de modalidades PAE reutilizables por contrato, cobertura y asignacion.';

CREATE TABLE IF NOT EXISTS master_experience_types (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE master_experience_types
  ADD COLUMN IF NOT EXISTS code        TEXT,
  ADD COLUMN IF NOT EXISTS name        TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS active      BOOLEAN,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

UPDATE master_experience_types
SET
  code = NULLIF(UPPER(BTRIM(code)), ''),
  name = NULLIF(BTRIM(name), ''),
  description = NULLIF(BTRIM(description), '');

UPDATE master_experience_types
SET code = 'EXP-' || id::TEXT
WHERE code IS NULL;

UPDATE master_experience_types
SET name = code
WHERE name IS NULL;

WITH ranked_codes AS (
  SELECT id, code, ROW_NUMBER() OVER (PARTITION BY code ORDER BY id) AS rn
  FROM master_experience_types
)
UPDATE master_experience_types met
SET code = ranked_codes.code || '-' || ranked_codes.rn::TEXT
FROM ranked_codes
WHERE met.id = ranked_codes.id
  AND ranked_codes.rn > 1;

WITH ranked_names AS (
  SELECT id, name, ROW_NUMBER() OVER (PARTITION BY UPPER(name) ORDER BY id) AS rn
  FROM master_experience_types
)
UPDATE master_experience_types met
SET name = ranked_names.name || ' ' || ranked_names.rn::TEXT
FROM ranked_names
WHERE met.id = ranked_names.id
  AND ranked_names.rn > 1;

UPDATE master_experience_types
SET
  active = COALESCE(active, true),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, created_at, NOW());

ALTER TABLE master_experience_types
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN active SET DEFAULT true,
  ALTER COLUMN active SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE master_experience_types DROP CONSTRAINT IF EXISTS master_experience_types_code_not_blank_ck;
ALTER TABLE master_experience_types DROP CONSTRAINT IF EXISTS master_experience_types_name_not_blank_ck;

ALTER TABLE master_experience_types
  ADD CONSTRAINT master_experience_types_code_not_blank_ck CHECK (BTRIM(code) <> ''),
  ADD CONSTRAINT master_experience_types_name_not_blank_ck CHECK (BTRIM(name) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS master_experience_types_code_uk
  ON master_experience_types (code);

CREATE UNIQUE INDEX IF NOT EXISTS master_experience_types_name_uk
  ON master_experience_types (name);

CREATE INDEX IF NOT EXISTS master_experience_types_active_idx
  ON master_experience_types (active);

DROP TRIGGER IF EXISTS master_experience_types_updated_at ON master_experience_types;
CREATE TRIGGER master_experience_types_updated_at
  BEFORE UPDATE ON master_experience_types
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE master_experience_types IS
  'Catalogo maestro de tipos de experiencia para validacion contractual.';

-- ---------------------------------------------------------------------
-- Puentes de compatibilidad sobre tablas actuales
-- ---------------------------------------------------------------------

ALTER TABLE document_types
  ADD COLUMN IF NOT EXISTS master_document_type_id INTEGER;

CREATE INDEX IF NOT EXISTS document_types_master_document_type_idx
  ON document_types (master_document_type_id);

ALTER TABLE document_types
  DROP CONSTRAINT IF EXISTS document_types_master_document_type_id_fkey;

ALTER TABLE document_types
  ADD CONSTRAINT document_types_master_document_type_id_fkey
  FOREIGN KEY (master_document_type_id)
  REFERENCES master_document_types(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN document_types.master_document_type_id IS
  'Puente de compatibilidad hacia el catalogo maestro documental.';

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS master_document_type_id INTEGER,
  ADD COLUMN IF NOT EXISTS employee_assignment_id INTEGER;

CREATE INDEX IF NOT EXISTS employee_documents_master_document_type_idx
  ON employee_documents (master_document_type_id);

CREATE INDEX IF NOT EXISTS employee_documents_assignment_idx
  ON employee_documents (employee_assignment_id);

COMMENT ON COLUMN employee_documents.master_document_type_id IS
  'Identifica el documento maestro equivalente sin romper la relacion actual con document_types.';

COMMENT ON COLUMN employee_documents.employee_assignment_id IS
  'Nueva relacion contractual por asignacion. Convive con employee_contract_id legado.';

-- ---------------------------------------------------------------------
-- Seeds y backfill de catalogos maestros
-- ---------------------------------------------------------------------

WITH global_base_docs(code, name, description, phase, visible_to_auditor) AS (
  VALUES
    ('hoja_vida', 'Hoja de vida', 'Documento base global de hoja de vida.', 'preingreso', true),
    ('cedula', 'Cédula', 'Documento base global de identificación.', 'preingreso', true),
    ('procuraduria', 'Procuraduría', 'Antecedentes Procuraduría.', 'preingreso', true),
    ('contraloria', 'Contraloría', 'Antecedentes Contraloría.', 'preingreso', true),
    ('antecedentes_policia', 'Judiciales', 'Antecedentes judiciales / Policía.', 'preingreso', true),
    ('rnmc', 'Medidas correctivas', 'Registro Nacional de Medidas Correctivas.', 'preingreso', true),
    ('redam', 'REDAM', 'Registro de Deudores Alimentarios Morosos.', 'preingreso', true),
    ('inhabilidades_delitos_sexuales', 'Inhabilidades por delitos sexuales', 'Consulta obligatoria de inhabilidades por delitos sexuales.', 'preingreso', true)
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
  gbd.code,
  gbd.name,
  gbd.description,
  gbd.phase,
  true,
  gbd.visible_to_auditor,
  true
FROM global_base_docs gbd
WHERE NOT EXISTS (
  SELECT 1
  FROM master_document_types mdt
  WHERE LOWER(BTRIM(mdt.code)) = gbd.code
);

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
  LOWER(BTRIM(dt.code)),
  BTRIM(dt.name),
  NULL,
  NULLIF(BTRIM(dt.phase), ''),
  LOWER(BTRIM(dt.code)) IN (
    'hoja_vida', 'cedula', 'procuraduria', 'contraloria',
    'antecedentes_policia', 'rnmc', 'redam', 'inhabilidades_delitos_sexuales'
  ),
  COALESCE(dt.visible_to_auditor, false),
  COALESCE(dt.active, true)
FROM document_types dt
WHERE NOT EXISTS (
  SELECT 1
  FROM master_document_types mdt
  WHERE LOWER(BTRIM(mdt.code)) = LOWER(BTRIM(dt.code))
);

UPDATE document_types dt
SET master_document_type_id = mdt.id
FROM master_document_types mdt
WHERE dt.master_document_type_id IS NULL
  AND (
    LOWER(BTRIM(dt.code)) = LOWER(BTRIM(mdt.code))
    OR UPPER(BTRIM(dt.name)) = UPPER(BTRIM(mdt.name))
  );

UPDATE employee_documents ed
SET master_document_type_id = dt.master_document_type_id
FROM document_types dt
WHERE ed.document_type_id = dt.id
  AND ed.master_document_type_id IS NULL;

INSERT INTO master_experience_types (code, name, description, active)
VALUES
  ('PAE', 'PAE', 'Experiencia específica en Programa de Alimentación Escolar.', true),
  ('BIENESTAR_SOCIAL', 'Bienestar social', 'Experiencia en bienestar social.', true),
  ('ALIMENTOS', 'Alimentos', 'Experiencia en operación, manipulación o gestión de alimentos.', true),
  ('ADMINISTRATIVA', 'Administrativa', 'Experiencia administrativa general o de soporte.', true),
  ('OTRAS', 'Otras', 'Experiencia general no clasificada en otra categoría.', true)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = EXCLUDED.active;

INSERT INTO master_modalities (code, name, description, active)
SELECT seed.code, seed.name, seed.description, true
FROM (
  SELECT 'CAA'::TEXT AS code, 'CAA'::TEXT AS name, 'Modalidad PAE CAA.'::TEXT AS description
  UNION ALL
  SELECT 'CAARES', 'CAARES', 'Modalidad PAE CAARES.'
  UNION ALL
  SELECT 'RI', 'RI', 'Modalidad PAE RI.'
) seed
WHERE NOT EXISTS (
  SELECT 1 FROM master_modalities mm WHERE UPPER(BTRIM(mm.code)) = seed.code
);

DO $$
BEGIN
  IF to_regclass('public.site_modalities') IS NOT NULL THEN
    INSERT INTO master_modalities (code, name, description, active)
    SELECT DISTINCT
      UPPER(BTRIM(sm.modality)) AS code,
      UPPER(BTRIM(sm.modality)) AS name,
      'Modalidad operativa detectada en site_modalities.' AS description,
      true
    FROM site_modalities sm
    WHERE NULLIF(BTRIM(sm.modality), '') IS NOT NULL
      AND UPPER(BTRIM(sm.modality)) <> 'N/A'
      AND NOT EXISTS (
        SELECT 1
        FROM master_modalities mm
        WHERE UPPER(BTRIM(mm.code)) = UPPER(BTRIM(sm.modality))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.coverage_upload_rows') IS NOT NULL THEN
    INSERT INTO master_modalities (code, name, description, active)
    SELECT DISTINCT
      UPPER(BTRIM(cur.modality)) AS code,
      UPPER(BTRIM(cur.modality)) AS name,
      'Modalidad detectada en cobertura.' AS description,
      true
    FROM coverage_upload_rows cur
    WHERE NULLIF(BTRIM(cur.modality), '') IS NOT NULL
      AND UPPER(BTRIM(cur.modality)) <> 'N/A'
      AND NOT EXISTS (
        SELECT 1
        FROM master_modalities mm
        WHERE UPPER(BTRIM(mm.code)) = UPPER(BTRIM(cur.modality))
      );
  END IF;
END $$;

INSERT INTO master_modalities (code, name, description, active)
SELECT DISTINCT
  UPPER(BTRIM(e.modality)) AS code,
  UPPER(BTRIM(e.modality)) AS name,
  'Modalidad detectada en employees.' AS description,
  true
FROM employees e
WHERE NULLIF(BTRIM(e.modality), '') IS NOT NULL
  AND UPPER(BTRIM(e.modality)) <> 'N/A'
  AND NOT EXISTS (
    SELECT 1
    FROM master_modalities mm
    WHERE UPPER(BTRIM(mm.code)) = UPPER(BTRIM(e.modality))
  );

-- ---------------------------------------------------------------------
-- Capa contractual enterprise
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contract_position_rules (
  id                              SERIAL PRIMARY KEY,
  tenant_id                       INTEGER NOT NULL DEFAULT 1,
  company_id                      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id                     INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  legacy_contract_position_id     INTEGER REFERENCES contract_positions(id) ON DELETE SET NULL,
  master_position_id              INTEGER REFERENCES master_positions(id) ON DELETE SET NULL,
  code                            TEXT NOT NULL,
  name                            TEXT NOT NULL,
  bid_position_name               TEXT,
  operational_position_name       TEXT,
  document_rule_source            TEXT NOT NULL,
  category                        TEXT,
  area_code                       TEXT REFERENCES master_areas(code) ON DELETE SET NULL,
  counts_for_coverage             BOOLEAN NOT NULL DEFAULT false,
  is_minimum_team                 BOOLEAN NOT NULL DEFAULT false,
  allows_extra_personnel          BOOLEAN NOT NULL DEFAULT true,
  manages_multiple_municipalities BOOLEAN NOT NULL DEFAULT false,
  workday_type                    TEXT,
  profile_level                   TEXT,
  position_type                   TEXT,
  notes                           TEXT,
  active                          BOOLEAN NOT NULL DEFAULT true,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contract_position_rules
  ADD COLUMN IF NOT EXISTS tenant_id                       INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS company_id                      INTEGER,
  ADD COLUMN IF NOT EXISTS contract_id                     INTEGER,
  ADD COLUMN IF NOT EXISTS legacy_contract_position_id     INTEGER,
  ADD COLUMN IF NOT EXISTS master_position_id              INTEGER,
  ADD COLUMN IF NOT EXISTS code                            TEXT,
  ADD COLUMN IF NOT EXISTS name                            TEXT,
  ADD COLUMN IF NOT EXISTS bid_position_name               TEXT,
  ADD COLUMN IF NOT EXISTS operational_position_name       TEXT,
  ADD COLUMN IF NOT EXISTS document_rule_source            TEXT,
  ADD COLUMN IF NOT EXISTS category                        TEXT,
  ADD COLUMN IF NOT EXISTS area_code                       TEXT,
  ADD COLUMN IF NOT EXISTS counts_for_coverage             BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_minimum_team                 BOOLEAN,
  ADD COLUMN IF NOT EXISTS allows_extra_personnel          BOOLEAN,
  ADD COLUMN IF NOT EXISTS manages_multiple_municipalities BOOLEAN,
  ADD COLUMN IF NOT EXISTS workday_type                    TEXT,
  ADD COLUMN IF NOT EXISTS profile_level                   TEXT,
  ADD COLUMN IF NOT EXISTS position_type                   TEXT,
  ADD COLUMN IF NOT EXISTS notes                           TEXT,
  ADD COLUMN IF NOT EXISTS active                          BOOLEAN,
  ADD COLUMN IF NOT EXISTS created_at                      TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at                      TIMESTAMPTZ DEFAULT NOW();

UPDATE contract_position_rules
SET
  code = NULLIF(UPPER(BTRIM(code)), ''),
  name = NULLIF(BTRIM(name), ''),
  bid_position_name = NULLIF(BTRIM(bid_position_name), ''),
  operational_position_name = NULLIF(BTRIM(operational_position_name), ''),
  document_rule_source = NULLIF(BTRIM(document_rule_source), ''),
  category = NULLIF(BTRIM(category), ''),
  area_code = NULLIF(UPPER(BTRIM(area_code)), ''),
  workday_type = NULLIF(BTRIM(workday_type), ''),
  profile_level = NULLIF(BTRIM(profile_level), ''),
  position_type = NULLIF(BTRIM(position_type), ''),
  notes = NULLIF(BTRIM(notes), '');

UPDATE contract_position_rules
SET code = 'CPR-' || id::TEXT
WHERE code IS NULL;

UPDATE contract_position_rules
SET
  name = COALESCE(name, code),
  document_rule_source = COALESCE(
    document_rule_source,
    CASE
      WHEN UPPER(COALESCE(BTRIM(bid_position_name), '')) = 'EXTRA'
        THEN COALESCE(operational_position_name, name, code)
      ELSE COALESCE(bid_position_name, operational_position_name, name, code)
    END
  ),
  counts_for_coverage = COALESCE(counts_for_coverage, false),
  is_minimum_team = COALESCE(is_minimum_team, false),
  allows_extra_personnel = COALESCE(allows_extra_personnel, true),
  manages_multiple_municipalities = COALESCE(manages_multiple_municipalities, false),
  active = COALESCE(active, true),
  tenant_id = COALESCE(tenant_id, 1),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, created_at, NOW());

ALTER TABLE contract_position_rules
  ALTER COLUMN tenant_id SET DEFAULT 1,
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN document_rule_source SET NOT NULL,
  ALTER COLUMN counts_for_coverage SET DEFAULT false,
  ALTER COLUMN counts_for_coverage SET NOT NULL,
  ALTER COLUMN is_minimum_team SET DEFAULT false,
  ALTER COLUMN is_minimum_team SET NOT NULL,
  ALTER COLUMN allows_extra_personnel SET DEFAULT true,
  ALTER COLUMN allows_extra_personnel SET NOT NULL,
  ALTER COLUMN manages_multiple_municipalities SET DEFAULT false,
  ALTER COLUMN manages_multiple_municipalities SET NOT NULL,
  ALTER COLUMN active SET DEFAULT true,
  ALTER COLUMN active SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE contract_position_rules DROP CONSTRAINT IF EXISTS contract_position_rules_code_not_blank_ck;
ALTER TABLE contract_position_rules DROP CONSTRAINT IF EXISTS contract_position_rules_name_not_blank_ck;
ALTER TABLE contract_position_rules DROP CONSTRAINT IF EXISTS contract_position_rules_document_rule_source_not_blank_ck;

ALTER TABLE contract_position_rules
  ADD CONSTRAINT contract_position_rules_code_not_blank_ck CHECK (BTRIM(code) <> ''),
  ADD CONSTRAINT contract_position_rules_name_not_blank_ck CHECK (BTRIM(name) <> ''),
  ADD CONSTRAINT contract_position_rules_document_rule_source_not_blank_ck CHECK (BTRIM(document_rule_source) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS contract_position_rules_contract_code_uk
  ON contract_position_rules (contract_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS contract_position_rules_legacy_uk
  ON contract_position_rules (legacy_contract_position_id)
  WHERE legacy_contract_position_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS contract_position_rules_contract_idx
  ON contract_position_rules (contract_id, active);

CREATE INDEX IF NOT EXISTS contract_position_rules_master_position_idx
  ON contract_position_rules (master_position_id);

DROP TRIGGER IF EXISTS contract_position_rules_updated_at ON contract_position_rules;
CREATE TRIGGER contract_position_rules_updated_at
  BEFORE UPDATE ON contract_position_rules
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE contract_position_rules IS
  'Reglas configurables por contrato para cargos, licitacion vs operacion, cobertura y area.';

COMMENT ON COLUMN contract_position_rules.document_rule_source IS
  'Fuente documental efectiva del cargo en el contrato.';

CREATE TABLE IF NOT EXISTS contract_municipalities (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL DEFAULT 1,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  municipality_id INTEGER NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_municipalities_uk
  ON contract_municipalities (contract_id, municipality_id);

CREATE INDEX IF NOT EXISTS contract_municipalities_contract_idx
  ON contract_municipalities (contract_id, active);

DROP TRIGGER IF EXISTS contract_municipalities_updated_at ON contract_municipalities;
CREATE TRIGGER contract_municipalities_updated_at
  BEFORE UPDATE ON contract_municipalities
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS contract_modalities (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER NOT NULL DEFAULT 1,
  company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id         INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  master_modality_id  INTEGER NOT NULL REFERENCES master_modalities(id) ON DELETE CASCADE,
  municipality_id     INTEGER REFERENCES municipalities(id) ON DELETE CASCADE,
  institution_id      INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
  site_id             INTEGER REFERENCES educational_sites(id) ON DELETE CASCADE,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_modalities_scope_uk
  ON contract_modalities (
    contract_id,
    master_modality_id,
    COALESCE(municipality_id, 0),
    COALESCE(institution_id, 0),
    COALESCE(site_id, 0)
  );

CREATE INDEX IF NOT EXISTS contract_modalities_contract_idx
  ON contract_modalities (contract_id, active);

DROP TRIGGER IF EXISTS contract_modalities_updated_at ON contract_modalities;
CREATE TRIGGER contract_modalities_updated_at
  BEFORE UPDATE ON contract_modalities
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS contract_document_rules (
  id                          SERIAL PRIMARY KEY,
  tenant_id                   INTEGER NOT NULL DEFAULT 1,
  company_id                  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id                 INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  contract_position_rule_id   INTEGER REFERENCES contract_position_rules(id) ON DELETE CASCADE,
  master_document_type_id     INTEGER NOT NULL REFERENCES master_document_types(id) ON DELETE CASCADE,
  master_modality_id          INTEGER REFERENCES master_modalities(id) ON DELETE SET NULL,
  municipality_id             INTEGER REFERENCES municipalities(id) ON DELETE CASCADE,
  institution_id              INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
  site_id                     INTEGER REFERENCES educational_sites(id) ON DELETE CASCADE,
  applies_to_staffing_type    TEXT NOT NULL DEFAULT 'ANY',
  required                    BOOLEAN NOT NULL DEFAULT true,
  expires                     BOOLEAN NOT NULL DEFAULT false,
  alert_days_before_expiration INTEGER,
  requires_approval           BOOLEAN NOT NULL DEFAULT true,
  validation_mode             TEXT NOT NULL DEFAULT 'DOCUMENTAL',
  notes                       TEXT,
  active                      BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contract_document_rules DROP CONSTRAINT IF EXISTS contract_document_rules_staffing_type_ck;
ALTER TABLE contract_document_rules DROP CONSTRAINT IF EXISTS contract_document_rules_alert_days_ck;

ALTER TABLE contract_document_rules
  ADD CONSTRAINT contract_document_rules_staffing_type_ck
    CHECK (applies_to_staffing_type IN ('ANY', 'LICITACION', 'EXTRA', 'INTERNO', 'APOYO')),
  ADD CONSTRAINT contract_document_rules_alert_days_ck
    CHECK (alert_days_before_expiration IS NULL OR alert_days_before_expiration >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS contract_document_rules_scope_uk
  ON contract_document_rules (
    contract_id,
    COALESCE(contract_position_rule_id, 0),
    master_document_type_id,
    COALESCE(master_modality_id, 0),
    COALESCE(municipality_id, 0),
    COALESCE(institution_id, 0),
    COALESCE(site_id, 0),
    applies_to_staffing_type
  );

CREATE INDEX IF NOT EXISTS contract_document_rules_contract_idx
  ON contract_document_rules (contract_id, active);

CREATE INDEX IF NOT EXISTS contract_document_rules_position_idx
  ON contract_document_rules (contract_position_rule_id);

DROP TRIGGER IF EXISTS contract_document_rules_updated_at ON contract_document_rules;
CREATE TRIGGER contract_document_rules_updated_at
  BEFORE UPDATE ON contract_document_rules
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE contract_document_rules IS
  'Reglas documentales contractuales configurables por cargo, modalidad y alcance operativo.';

CREATE TABLE IF NOT EXISTS contract_experience_rules (
  id                        SERIAL PRIMARY KEY,
  tenant_id                 INTEGER NOT NULL DEFAULT 1,
  company_id                INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id               INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  contract_position_rule_id INTEGER NOT NULL REFERENCES contract_position_rules(id) ON DELETE CASCADE,
  master_experience_type_id INTEGER NOT NULL REFERENCES master_experience_types(id) ON DELETE CASCADE,
  applies_to_staffing_type  TEXT NOT NULL DEFAULT 'ANY',
  specificity_type          TEXT NOT NULL DEFAULT 'GENERAL',
  minimum_months            INTEGER NOT NULL DEFAULT 0,
  notes                     TEXT,
  active                    BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contract_experience_rules DROP CONSTRAINT IF EXISTS contract_experience_rules_staffing_type_ck;
ALTER TABLE contract_experience_rules DROP CONSTRAINT IF EXISTS contract_experience_rules_specificity_ck;
ALTER TABLE contract_experience_rules DROP CONSTRAINT IF EXISTS contract_experience_rules_min_months_ck;

ALTER TABLE contract_experience_rules
  ADD CONSTRAINT contract_experience_rules_staffing_type_ck
    CHECK (applies_to_staffing_type IN ('ANY', 'LICITACION', 'EXTRA', 'INTERNO', 'APOYO')),
  ADD CONSTRAINT contract_experience_rules_specificity_ck
    CHECK (specificity_type IN ('GENERAL', 'ESPECIFICA')),
  ADD CONSTRAINT contract_experience_rules_min_months_ck
    CHECK (minimum_months >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS contract_experience_rules_scope_uk
  ON contract_experience_rules (
    contract_position_rule_id,
    master_experience_type_id,
    applies_to_staffing_type,
    specificity_type
  );

CREATE INDEX IF NOT EXISTS contract_experience_rules_contract_idx
  ON contract_experience_rules (contract_id, active);

DROP TRIGGER IF EXISTS contract_experience_rules_updated_at ON contract_experience_rules;
CREATE TRIGGER contract_experience_rules_updated_at
  BEFORE UPDATE ON contract_experience_rules
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE contract_experience_rules IS
  'Reglas de experiencia configurables por contrato y cargo.';

CREATE TABLE IF NOT EXISTS contract_coverage_rules (
  id                        SERIAL PRIMARY KEY,
  tenant_id                 INTEGER NOT NULL DEFAULT 1,
  company_id                INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id               INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  contract_position_rule_id INTEGER REFERENCES contract_position_rules(id) ON DELETE CASCADE,
  master_modality_id        INTEGER REFERENCES master_modalities(id) ON DELETE SET NULL,
  municipality_id           INTEGER REFERENCES municipalities(id) ON DELETE CASCADE,
  institution_id            INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
  site_id                   INTEGER REFERENCES educational_sites(id) ON DELETE CASCADE,
  coverage_mode             TEXT NOT NULL DEFAULT 'UPLOAD',
  enabled                   BOOLEAN NOT NULL DEFAULT true,
  minimum_cupos             INTEGER,
  maximum_cupos             INTEGER,
  required_tc               INTEGER,
  required_mt               INTEGER,
  notes                     TEXT,
  active                    BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contract_coverage_rules DROP CONSTRAINT IF EXISTS contract_coverage_rules_mode_ck;
ALTER TABLE contract_coverage_rules DROP CONSTRAINT IF EXISTS contract_coverage_rules_cupos_ck;

ALTER TABLE contract_coverage_rules
  ADD CONSTRAINT contract_coverage_rules_mode_ck
    CHECK (coverage_mode IN ('UPLOAD', 'MANUAL', 'FORMULA')),
  ADD CONSTRAINT contract_coverage_rules_cupos_ck
    CHECK (
      minimum_cupos IS NULL
      OR maximum_cupos IS NULL
      OR minimum_cupos <= maximum_cupos
    );

CREATE UNIQUE INDEX IF NOT EXISTS contract_coverage_rules_scope_uk
  ON contract_coverage_rules (
    contract_id,
    COALESCE(contract_position_rule_id, 0),
    COALESCE(master_modality_id, 0),
    COALESCE(municipality_id, 0),
    COALESCE(institution_id, 0),
    COALESCE(site_id, 0),
    coverage_mode
  );

CREATE INDEX IF NOT EXISTS contract_coverage_rules_contract_idx
  ON contract_coverage_rules (contract_id, active, enabled);

DROP TRIGGER IF EXISTS contract_coverage_rules_updated_at ON contract_coverage_rules;
CREATE TRIGGER contract_coverage_rules_updated_at
  BEFORE UPDATE ON contract_coverage_rules
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE contract_coverage_rules IS
  'Reglas de cobertura por contrato, modalidad y alcance territorial.';

CREATE TABLE IF NOT EXISTS employee_experiences (
  id                        SERIAL PRIMARY KEY,
  employee_id               INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employee_assignment_id    INTEGER,
  company_name              TEXT NOT NULL,
  position_name             TEXT NOT NULL,
  master_experience_type_id INTEGER NOT NULL REFERENCES master_experience_types(id) ON DELETE RESTRICT,
  source_type               TEXT NOT NULL DEFAULT 'EXTERNA',
  start_date                DATE NOT NULL,
  end_date                  DATE,
  months_calculated         INTEGER NOT NULL DEFAULT 0,
  support_file_url          TEXT,
  support_file_name         TEXT,
  validated                 BOOLEAN NOT NULL DEFAULT false,
  validated_by_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  validated_at              TIMESTAMPTZ,
  observations              TEXT,
  active                    BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE employee_experiences DROP CONSTRAINT IF EXISTS employee_experiences_source_type_ck;
ALTER TABLE employee_experiences DROP CONSTRAINT IF EXISTS employee_experiences_dates_ck;

ALTER TABLE employee_experiences
  ADD CONSTRAINT employee_experiences_source_type_ck
    CHECK (source_type IN ('EXTERNA', 'INTERNA')),
  ADD CONSTRAINT employee_experiences_dates_ck
    CHECK (end_date IS NULL OR end_date >= start_date);

CREATE INDEX IF NOT EXISTS employee_experiences_employee_idx
  ON employee_experiences (employee_id, active);

CREATE INDEX IF NOT EXISTS employee_experiences_type_idx
  ON employee_experiences (master_experience_type_id, validated);

DROP TRIGGER IF EXISTS employee_experiences_updated_at ON employee_experiences;
CREATE TRIGGER employee_experiences_updated_at
  BEFORE UPDATE ON employee_experiences
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS employee_experiences_months_trg ON employee_experiences;
CREATE TRIGGER employee_experiences_months_trg
  BEFORE INSERT OR UPDATE OF start_date, end_date
  ON employee_experiences
  FOR EACH ROW
  EXECUTE FUNCTION set_employee_experience_months();

COMMENT ON TABLE employee_experiences IS
  'Experiencia laboral estructurada del empleado para validacion automatica.';

CREATE TABLE IF NOT EXISTS employee_contract_assignments (
  id                              SERIAL PRIMARY KEY,
  employee_id                     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tenant_id                       INTEGER NOT NULL DEFAULT 1,
  company_id                      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id                     INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  legacy_employee_contract_id     INTEGER REFERENCES employee_contracts(id) ON DELETE SET NULL,
  contract_position_rule_id       INTEGER REFERENCES contract_position_rules(id) ON DELETE SET NULL,
  master_position_id              INTEGER REFERENCES master_positions(id) ON DELETE SET NULL,
  bid_position_name               TEXT,
  operational_position_name       TEXT,
  document_rule_source            TEXT NOT NULL,
  area_code                       TEXT REFERENCES master_areas(code) ON DELETE SET NULL,
  municipality_id                 INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  institution_id                  INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  site_id                         INTEGER REFERENCES educational_sites(id) ON DELETE SET NULL,
  master_modality_id              INTEGER REFERENCES master_modalities(id) ON DELETE SET NULL,
  modality_name                   TEXT,
  workday_type                    TEXT,
  presented_in_bid                BOOLEAN NOT NULL DEFAULT false,
  staffing_type                   TEXT NOT NULL DEFAULT 'EXTRA',
  coverage_enabled                BOOLEAN NOT NULL DEFAULT false,
  manages_multiple_municipalities BOOLEAN NOT NULL DEFAULT false,
  assignment_start_date           DATE,
  assignment_end_date             DATE,
  status                          TEXT NOT NULL DEFAULT 'ACTIVO',
  notes                           TEXT,
  active                          BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE employee_contract_assignments DROP CONSTRAINT IF EXISTS employee_contract_assignments_staffing_type_ck;
ALTER TABLE employee_contract_assignments DROP CONSTRAINT IF EXISTS employee_contract_assignments_dates_ck;

ALTER TABLE employee_contract_assignments
  ADD CONSTRAINT employee_contract_assignments_staffing_type_ck
    CHECK (staffing_type IN ('LICITACION', 'EXTRA', 'INTERNO', 'APOYO')),
  ADD CONSTRAINT employee_contract_assignments_dates_ck
    CHECK (assignment_end_date IS NULL OR assignment_start_date IS NULL OR assignment_end_date >= assignment_start_date);

CREATE UNIQUE INDEX IF NOT EXISTS employee_contract_assignments_current_uk
  ON employee_contract_assignments (employee_id, contract_id)
  WHERE active = true AND assignment_end_date IS NULL;

CREATE INDEX IF NOT EXISTS employee_contract_assignments_employee_idx
  ON employee_contract_assignments (employee_id, active);

CREATE INDEX IF NOT EXISTS employee_contract_assignments_contract_idx
  ON employee_contract_assignments (contract_id, active);

CREATE INDEX IF NOT EXISTS employee_contract_assignments_position_idx
  ON employee_contract_assignments (contract_position_rule_id);

DROP TRIGGER IF EXISTS employee_contract_assignments_updated_at ON employee_contract_assignments;
CREATE TRIGGER employee_contract_assignments_updated_at
  BEFORE UPDATE ON employee_contract_assignments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE employee_contract_assignments IS
  'Relacion reutilizable del empleado con cada contrato, cargo, modalidad y operacion.';

CREATE TABLE IF NOT EXISTS employee_assignment_municipalities (
  id              SERIAL PRIMARY KEY,
  assignment_id   INTEGER NOT NULL REFERENCES employee_contract_assignments(id) ON DELETE CASCADE,
  municipality_id INTEGER NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_assignment_municipalities_uk
  ON employee_assignment_municipalities (assignment_id, municipality_id);

CREATE INDEX IF NOT EXISTS employee_assignment_municipalities_assignment_idx
  ON employee_assignment_municipalities (assignment_id, active);

DROP TRIGGER IF EXISTS employee_assignment_municipalities_updated_at ON employee_assignment_municipalities;
CREATE TRIGGER employee_assignment_municipalities_updated_at
  BEFORE UPDATE ON employee_assignment_municipalities
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS employee_assignment_history (
  id                SERIAL PRIMARY KEY,
  assignment_id     INTEGER NOT NULL REFERENCES employee_contract_assignments(id) ON DELETE CASCADE,
  employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id        INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  contract_id       INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
  action_type       TEXT NOT NULL,
  field_name        TEXT,
  old_value         JSONB,
  new_value         JSONB,
  snapshot_before   JSONB,
  snapshot_after    JSONB,
  changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_assignment_history_assignment_idx
  ON employee_assignment_history (assignment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS employee_assignment_history_employee_idx
  ON employee_assignment_history (employee_id, created_at DESC);

COMMENT ON TABLE employee_assignment_history IS
  'Historial laboral contractual por asignacion, incluyendo cambios de cargo, municipio, modalidad, sede y jornada.';

CREATE TABLE IF NOT EXISTS employment_certificates (
  id                 SERIAL PRIMARY KEY,
  employee_id        INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assignment_id      INTEGER REFERENCES employee_contract_assignments(id) ON DELETE SET NULL,
  company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id        INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  certificate_number TEXT NOT NULL,
  purpose            TEXT,
  issue_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  issued_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  signatory_name     TEXT,
  signatory_role     TEXT,
  status             TEXT NOT NULL DEFAULT 'GENERADA',
  snapshot_data      JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_url           TEXT,
  file_name          TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS employment_certificates_number_uk
  ON employment_certificates (certificate_number);

CREATE INDEX IF NOT EXISTS employment_certificates_employee_idx
  ON employment_certificates (employee_id, issue_date DESC);

DROP TRIGGER IF EXISTS employment_certificates_updated_at ON employment_certificates;
CREATE TRIGGER employment_certificates_updated_at
  BEFORE UPDATE ON employment_certificates
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE employment_certificates IS
  'Certificaciones laborales generadas desde EMPIRIA con snapshot contractual.';

CREATE TABLE IF NOT EXISTS audit_logs (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL DEFAULT 1,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  module          TEXT NOT NULL,
  entity_name     TEXT NOT NULL,
  entity_id       TEXT,
  action          TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON audit_logs (entity_name, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_module_idx
  ON audit_logs (module, created_at DESC);

COMMENT ON TABLE audit_logs IS
  'Auditoria transversal de acciones sobre la nueva arquitectura contractual.';

ALTER TABLE employee_documents
  DROP CONSTRAINT IF EXISTS employee_documents_employee_assignment_id_fkey;

ALTER TABLE employee_documents
  ADD CONSTRAINT employee_documents_employee_assignment_id_fkey
  FOREIGN KEY (employee_assignment_id)
  REFERENCES employee_contract_assignments(id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- Backfill inicial desde estructuras actuales
-- ---------------------------------------------------------------------

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
  CASE
    WHEN UPPER(BTRIM(COALESCE(cp.category, ''))) = 'EXTRA' THEN BTRIM(cp.name)
    ELSE BTRIM(cp.name)
  END AS document_rule_source,
  cp.category,
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
  SELECT mp2.*
  FROM master_positions mp2
  WHERE UPPER(BTRIM(COALESCE(mp2.bid_position_name, ''))) = UPPER(BTRIM(cp.name))
     OR UPPER(BTRIM(COALESCE(mp2.document_rule_source, ''))) = UPPER(BTRIM(cp.name))
     OR UPPER(BTRIM(COALESCE(mp2.operational_position_name, ''))) = UPPER(BTRIM(cp.name))
  ORDER BY mp2.id
  LIMIT 1
) mp ON true
LEFT JOIN master_areas ma
  ON mp.area IS NOT NULL
 AND UPPER(BTRIM(ma.name)) = UPPER(BTRIM(mp.area))
WHERE NOT EXISTS (
  SELECT 1
  FROM contract_position_rules cpr
  WHERE cpr.legacy_contract_position_id = cp.id
);

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

INSERT INTO contract_municipalities (
  tenant_id,
  company_id,
  contract_id,
  municipality_id,
  active
)
SELECT DISTINCT
  e.tenant_id,
  e.company_id,
  e.contract_id,
  e.municipality_id,
  true
FROM employees e
WHERE e.company_id IS NOT NULL
  AND e.contract_id IS NOT NULL
  AND e.municipality_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM contract_municipalities cm
    WHERE cm.contract_id = e.contract_id
      AND cm.municipality_id = e.municipality_id
  );

INSERT INTO contract_modalities (
  tenant_id,
  company_id,
  contract_id,
  master_modality_id,
  municipality_id,
  institution_id,
  site_id,
  active
)
SELECT DISTINCT
  e.tenant_id,
  e.company_id,
  e.contract_id,
  mm.id,
  e.municipality_id,
  e.institution_id,
  e.site_id,
  true
FROM employees e
JOIN master_modalities mm
  ON UPPER(BTRIM(mm.code)) = UPPER(BTRIM(e.modality))
WHERE e.company_id IS NOT NULL
  AND e.contract_id IS NOT NULL
  AND NULLIF(BTRIM(e.modality), '') IS NOT NULL
  AND UPPER(BTRIM(e.modality)) <> 'N/A'
  AND NOT EXISTS (
    SELECT 1
    FROM contract_modalities cm
    WHERE cm.contract_id = e.contract_id
      AND cm.master_modality_id = mm.id
      AND COALESCE(cm.municipality_id, 0) = COALESCE(e.municipality_id, 0)
      AND COALESCE(cm.institution_id, 0) = COALESCE(e.institution_id, 0)
      AND COALESCE(cm.site_id, 0) = COALESCE(e.site_id, 0)
  );

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
    WHEN e.presented_in_offer = true AND NULLIF(BTRIM(COALESCE(e.offered_position, e.offer_position)), '') IS NOT NULL
      THEN BTRIM(COALESCE(e.offered_position, e.offer_position))
    ELSE 'EXTRA'
  END AS bid_position_name,
  NULLIF(BTRIM(e.real_position), '') AS operational_position_name,
  CASE
    WHEN e.presented_in_offer = true AND NULLIF(BTRIM(COALESCE(e.offered_position, e.offer_position)), '') IS NOT NULL
      THEN BTRIM(COALESCE(e.offered_position, e.offer_position))
    ELSE COALESCE(NULLIF(BTRIM(e.real_position), ''), 'SIN_DEFINIR')
  END AS document_rule_source,
  ma.code AS area_code,
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
  SELECT mp2.*
  FROM master_positions mp2
  WHERE (
    e.presented_in_offer = true
    AND NULLIF(BTRIM(COALESCE(e.offered_position, e.offer_position)), '') IS NOT NULL
    AND (
      UPPER(BTRIM(COALESCE(mp2.bid_position_name, ''))) = UPPER(BTRIM(COALESCE(e.offered_position, e.offer_position)))
      OR UPPER(BTRIM(COALESCE(mp2.document_rule_source, ''))) = UPPER(BTRIM(COALESCE(e.offered_position, e.offer_position)))
    )
  ) OR (
    COALESCE(e.presented_in_offer, false) = false
    AND NULLIF(BTRIM(e.real_position), '') IS NOT NULL
    AND (
      UPPER(BTRIM(COALESCE(mp2.operational_position_name, ''))) = UPPER(BTRIM(e.real_position))
      OR UPPER(BTRIM(COALESCE(mp2.document_rule_source, ''))) = UPPER(BTRIM(e.real_position))
    )
  )
  ORDER BY mp2.id
  LIMIT 1
) mp ON true
LEFT JOIN master_areas ma
  ON mp.area IS NOT NULL
 AND UPPER(BTRIM(ma.name)) = UPPER(BTRIM(mp.area))
LEFT JOIN LATERAL (
  SELECT cpr2.*
  FROM contract_position_rules cpr2
  WHERE cpr2.contract_id = e.contract_id
    AND cpr2.active = true
    AND (
      (
        e.presented_in_offer = true
        AND NULLIF(BTRIM(COALESCE(e.offered_position, e.offer_position)), '') IS NOT NULL
        AND UPPER(BTRIM(cpr2.document_rule_source)) = UPPER(BTRIM(COALESCE(e.offered_position, e.offer_position)))
      )
      OR (
        COALESCE(e.presented_in_offer, false) = false
        AND NULLIF(BTRIM(e.real_position), '') IS NOT NULL
        AND (
          UPPER(BTRIM(cpr2.document_rule_source)) = UPPER(BTRIM(e.real_position))
          OR UPPER(BTRIM(COALESCE(cpr2.operational_position_name, ''))) = UPPER(BTRIM(e.real_position))
          OR UPPER(BTRIM(cpr2.name)) = UPPER(BTRIM(e.real_position))
        )
      )
    )
  ORDER BY cpr2.id
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
FROM employee_contract_assignments eca
WHERE ed.employee_id = eca.employee_id
  AND ed.employee_assignment_id IS NULL
  AND eca.active = true
  AND eca.assignment_end_date IS NULL;

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
  'Backfill inicial desde employees.'
FROM employee_contract_assignments eca
WHERE NOT EXISTS (
  SELECT 1
  FROM employee_assignment_history eah
  WHERE eah.assignment_id = eca.id
    AND eah.action_type = 'MIGRATED'
);
