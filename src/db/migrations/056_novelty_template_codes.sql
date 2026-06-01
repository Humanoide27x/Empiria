-- ─────────────────────────────────────────────────────────────────────────────
-- 056 · Códigos cortos para plantilla de novedades mensuales
-- Agrega template_code a payroll_novelty_types y siembra los defaults.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payroll_novelty_types
  ADD COLUMN IF NOT EXISTS template_code VARCHAR(10);

-- Códigos cortos por defecto (el admin puede cambiarlos directamente en la tabla)
UPDATE payroll_novelty_types SET template_code = 'I'   WHERE code = 'INCAPACIDAD_MEDICA';
UPDATE payroll_novelty_types SET template_code = 'IA'  WHERE code = 'INCAPACIDAD_ACCIDENTE_LABORAL';
UPDATE payroll_novelty_types SET template_code = 'S'   WHERE code = 'SUSPENSION';
UPDATE payroll_novelty_types SET template_code = 'LN'  WHERE code = 'PERMISOS_NO_REMUNERADOS';
UPDATE payroll_novelty_types SET template_code = 'LM'  WHERE code = 'LICENCIA_MATERNIDAD_PATERNIDAD';
UPDATE payroll_novelty_types SET template_code = 'CA'  WHERE code = 'CALAMIDAD_FAMILIAR';
UPDATE payroll_novelty_types SET template_code = 'LT'  WHERE code = 'LUTO';
UPDATE payroll_novelty_types SET template_code = 'CM'  WHERE code = 'CITA_MEDICA';
UPDATE payroll_novelty_types SET template_code = 'CF'  WHERE code = 'CITA_MEDICA_FAMILIAR';
UPDATE payroll_novelty_types SET template_code = 'CO'  WHERE code = 'CITACIONES_OFICIALES';
UPDATE payroll_novelty_types SET template_code = 'N'   WHERE code = 'DIAS_NO_CLASE';
UPDATE payroll_novelty_types SET template_code = 'R'   WHERE code = 'FECHA_RETIRO';
UPDATE payroll_novelty_types SET template_code = 'FI'  WHERE code = 'FECHA_INGRESO';
