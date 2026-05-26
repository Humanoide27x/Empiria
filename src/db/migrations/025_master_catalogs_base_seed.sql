-- =====================================================================
-- Seed base e idempotente de catalogos maestros EMPIRIA.
-- No elimina datos existentes; solo canoniza y agrega registros base.
-- Compatible con 021, 022, 023 y 024.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Areas oficiales EMPIRIA
-- ---------------------------------------------------------------------

WITH official_areas(code, name, description) AS (
  VALUES
    ('OAL', 'Operacion Alimentaria', 'Manipuladores'),
    ('CAL', 'Calidad', 'Supervision y calidad'),
    ('LOG', 'Logistica', 'Bodega y transporte'),
    ('OTE', 'Operacion Territorial', 'Coordinadores zona y auxiliares PAE'),
    ('TH',  'TH', 'Talento humano'),
    ('SST', 'SST', 'Seguridad y salud'),
    ('ADM', 'Administrativo', 'Auxiliares administrativos'),
    ('GER', 'Gerencia', 'Directivos'),
    ('SGE', 'Servicios Generales', 'Aseo/mantenimiento'),
    ('FAC', 'Facturacion', 'Facturacion')
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
    ('OAL', 'Operacion Alimentaria', 'Manipuladores'),
    ('CAL', 'Calidad', 'Supervision y calidad'),
    ('LOG', 'Logistica', 'Bodega y transporte'),
    ('OTE', 'Operacion Territorial', 'Coordinadores zona y auxiliares PAE'),
    ('TH',  'TH', 'Talento humano'),
    ('SST', 'SST', 'Seguridad y salud'),
    ('ADM', 'Administrativo', 'Auxiliares administrativos'),
    ('GER', 'Gerencia', 'Directivos'),
    ('SGE', 'Servicios Generales', 'Aseo/mantenimiento'),
    ('FAC', 'Facturacion', 'Facturacion')
) AS oa(code, name, description)
WHERE NOT EXISTS (
  SELECT 1
  FROM master_areas ma
  WHERE UPPER(BTRIM(ma.code)) = oa.code
     OR UPPER(BTRIM(ma.name)) = UPPER(oa.name)
);

-- ---------------------------------------------------------------------
-- Documentos base globales
-- ---------------------------------------------------------------------

WITH base_document_types(code, name, description, phase, is_global_base, visible_to_auditor) AS (
  VALUES
    ('hoja_vida', 'Hoja de vida', 'Documento base global de hoja de vida.', 'preingreso', true, true),
    ('cedula', 'Cedula', 'Documento base global de identificacion.', 'preingreso', true, true),
    ('procuraduria', 'Procuraduria', 'Antecedentes Procuraduria.', 'preingreso', true, true),
    ('contraloria', 'Contraloria', 'Antecedentes Contraloria.', 'preingreso', true, true),
    ('antecedentes_policia', 'Judiciales', 'Antecedentes judiciales o Policia.', 'preingreso', true, true),
    ('rnmc', 'Medidas correctivas', 'Registro Nacional de Medidas Correctivas.', 'preingreso', true, true),
    ('redam', 'REDAM', 'Registro de Deudores Alimentarios Morosos.', 'preingreso', true, true),
    ('inhabilidades_delitos_sexuales', 'Inhabilidades por delitos sexuales', 'Consulta obligatoria de inhabilidades por delitos sexuales.', 'preingreso', true, true)
)
UPDATE master_document_types mdt
SET
  code = bdt.code,
  name = bdt.name,
  description = bdt.description,
  phase = bdt.phase,
  is_global_base = bdt.is_global_base,
  visible_to_auditor = bdt.visible_to_auditor,
  active = true
FROM base_document_types bdt
WHERE LOWER(BTRIM(mdt.code)) = bdt.code
   OR UPPER(BTRIM(mdt.name)) = UPPER(bdt.name);

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
  bdt.code,
  bdt.name,
  bdt.description,
  bdt.phase,
  bdt.is_global_base,
  bdt.visible_to_auditor,
  true
FROM (
  VALUES
    ('hoja_vida', 'Hoja de vida', 'Documento base global de hoja de vida.', 'preingreso', true, true),
    ('cedula', 'Cedula', 'Documento base global de identificacion.', 'preingreso', true, true),
    ('procuraduria', 'Procuraduria', 'Antecedentes Procuraduria.', 'preingreso', true, true),
    ('contraloria', 'Contraloria', 'Antecedentes Contraloria.', 'preingreso', true, true),
    ('antecedentes_policia', 'Judiciales', 'Antecedentes judiciales o Policia.', 'preingreso', true, true),
    ('rnmc', 'Medidas correctivas', 'Registro Nacional de Medidas Correctivas.', 'preingreso', true, true),
    ('redam', 'REDAM', 'Registro de Deudores Alimentarios Morosos.', 'preingreso', true, true),
    ('inhabilidades_delitos_sexuales', 'Inhabilidades por delitos sexuales', 'Consulta obligatoria de inhabilidades por delitos sexuales.', 'preingreso', true, true)
) AS bdt(code, name, description, phase, is_global_base, visible_to_auditor)
WHERE NOT EXISTS (
  SELECT 1
  FROM master_document_types mdt
  WHERE LOWER(BTRIM(mdt.code)) = bdt.code
     OR UPPER(BTRIM(mdt.name)) = UPPER(bdt.name)
);

-- ---------------------------------------------------------------------
-- Tipos de experiencia base
-- ---------------------------------------------------------------------

WITH base_experience_types(code, name, description) AS (
  VALUES
    ('PAE', 'PAE', 'Experiencia especifica en Programa de Alimentacion Escolar.'),
    ('BIENESTAR_SOCIAL', 'Bienestar social', 'Experiencia en bienestar social.'),
    ('ALIMENTOS', 'Alimentos', 'Experiencia en operacion, manipulacion o gestion de alimentos.'),
    ('ADMINISTRATIVA', 'Administrativa', 'Experiencia administrativa general o de soporte.'),
    ('OTRAS', 'Otras', 'Experiencia general no clasificada en otra categoria.')
)
UPDATE master_experience_types met
SET
  code = bet.code,
  name = bet.name,
  description = bet.description,
  active = true
FROM base_experience_types bet
WHERE UPPER(BTRIM(met.code)) = bet.code
   OR UPPER(BTRIM(met.name)) = UPPER(bet.name);

INSERT INTO master_experience_types (
  code,
  name,
  description,
  active
)
SELECT
  bet.code,
  bet.name,
  bet.description,
  true
FROM (
  VALUES
    ('PAE', 'PAE', 'Experiencia especifica en Programa de Alimentacion Escolar.'),
    ('BIENESTAR_SOCIAL', 'Bienestar social', 'Experiencia en bienestar social.'),
    ('ALIMENTOS', 'Alimentos', 'Experiencia en operacion, manipulacion o gestion de alimentos.'),
    ('ADMINISTRATIVA', 'Administrativa', 'Experiencia administrativa general o de soporte.'),
    ('OTRAS', 'Otras', 'Experiencia general no clasificada en otra categoria.')
) AS bet(code, name, description)
WHERE NOT EXISTS (
  SELECT 1
  FROM master_experience_types met
  WHERE UPPER(BTRIM(met.code)) = bet.code
     OR UPPER(BTRIM(met.name)) = UPPER(bet.name)
);

-- ---------------------------------------------------------------------
-- Modalidades base
-- ---------------------------------------------------------------------

WITH base_modalities(code, name, description) AS (
  VALUES
    ('CAA', 'CAA', 'Modalidad PAE CAA.'),
    ('CAARES', 'CAARES', 'Modalidad PAE CAARES.'),
    ('RI', 'RI', 'Modalidad PAE RI.')
)
UPDATE master_modalities mm
SET
  code = bm.code,
  name = bm.name,
  description = bm.description,
  active = true
FROM base_modalities bm
WHERE UPPER(BTRIM(mm.code)) = bm.code
   OR UPPER(BTRIM(mm.name)) = UPPER(bm.name);

INSERT INTO master_modalities (
  code,
  name,
  description,
  active
)
SELECT
  bm.code,
  bm.name,
  bm.description,
  true
FROM (
  VALUES
    ('CAA', 'CAA', 'Modalidad PAE CAA.'),
    ('CAARES', 'CAARES', 'Modalidad PAE CAARES.'),
    ('RI', 'RI', 'Modalidad PAE RI.')
) AS bm(code, name, description)
WHERE NOT EXISTS (
  SELECT 1
  FROM master_modalities mm
  WHERE UPPER(BTRIM(mm.code)) = bm.code
     OR UPPER(BTRIM(mm.name)) = UPPER(bm.name)
);
