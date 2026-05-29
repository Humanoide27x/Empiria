-- Migration 040: Rename novelty type CITACION_COLEGIO → CITACIONES_OFICIALES
-- Abarca: catálogo, registros históricos, y CHECK constraint.

BEGIN;

-- ── 1. Eliminar CHECK constraint si incluye el código viejo ──────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_novelty_type'
      AND conrelid = 'payroll_novelties'::regclass
  ) THEN
    ALTER TABLE payroll_novelties DROP CONSTRAINT chk_novelty_type;
    RAISE NOTICE '040: chk_novelty_type eliminado para renames.';
  END IF;
END $$;

-- ── 2. Renombrar en catálogo de tipos ────────────────────────────────────────
UPDATE payroll_novelty_types
   SET code = 'CITACIONES_OFICIALES',
       name = 'Citaciones (Fiscalía, Procuraduría, Unidad de Víctimas, Colegio, Comisaría, Juzgado, Personería, EPS, ARL, etc.)'
 WHERE code = 'CITACION_COLEGIO';

-- ── 3. Convertir todos los registros históricos ──────────────────────────────
UPDATE payroll_novelties
   SET novelty_type = 'CITACIONES_OFICIALES'
 WHERE novelty_type = 'CITACION_COLEGIO';

-- ── 4. Recrear CHECK constraint con el catálogo actualizado ──────────────────
DO $$
DECLARE
  legacy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO legacy_count
  FROM payroll_novelties
  WHERE novelty_type IS NOT NULL
    AND novelty_type NOT IN (
      'DIAS_NO_CLASE',
      'CITA_MEDICA',
      'CITA_MEDICA_FAMILIAR',
      'INCAPACIDAD_MEDICA',
      'INCAPACIDAD_ACCIDENTE_LABORAL',
      'CALAMIDAD_FAMILIAR',
      'LUTO',
      'PERMISOS_NO_REMUNERADOS',
      'CITACIONES_OFICIALES',
      'LICENCIA_MATERNIDAD_PATERNIDAD',
      'SUSPENSION',
      'FECHA_INGRESO',
      'FECHA_RETIRO',
      'CAMBIO_OPERATIVO_COBERTURA'
    );

  IF legacy_count > 0 THEN
    RAISE NOTICE '040: % fila(s) con código no reconocido — constraint no re-aplicado, validación queda en backend.', legacy_count;
  ELSE
    ALTER TABLE payroll_novelties
      ADD CONSTRAINT chk_novelty_type CHECK (
        novelty_type IS NULL OR novelty_type = ANY (ARRAY[
          'DIAS_NO_CLASE',
          'CITA_MEDICA',
          'CITA_MEDICA_FAMILIAR',
          'INCAPACIDAD_MEDICA',
          'INCAPACIDAD_ACCIDENTE_LABORAL',
          'CALAMIDAD_FAMILIAR',
          'LUTO',
          'PERMISOS_NO_REMUNERADOS',
          'CITACIONES_OFICIALES',
          'LICENCIA_MATERNIDAD_PATERNIDAD',
          'SUSPENSION',
          'FECHA_INGRESO',
          'FECHA_RETIRO',
          'CAMBIO_OPERATIVO_COBERTURA'
        ])
      );
    RAISE NOTICE '040: chk_novelty_type recreado con CITACIONES_OFICIALES.';
  END IF;
END $$;

COMMIT;
