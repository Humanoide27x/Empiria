-- 054_add_correccion_ss_to_constraint.sql
-- La migración 053 insertó CORRECCION_SEGURIDAD_SOCIAL en payroll_novelty_types,
-- pero no actualizó el CHECK constraint de payroll_novelties (chk_novelty_type).
-- Esta migración recrea el constraint incluyendo el nuevo tipo.

BEGIN;

-- ── 1. Eliminar constraint existente ─────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname    = 'chk_novelty_type'
      AND conrelid   = 'payroll_novelties'::regclass
  ) THEN
    ALTER TABLE payroll_novelties DROP CONSTRAINT chk_novelty_type;
    RAISE NOTICE '054: chk_novelty_type anterior eliminado.';
  END IF;
END $$;

-- ── 2. Verificar que no haya valores huérfanos que bloqueen el constraint ─────
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
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
      'CAMBIO_OPERATIVO_COBERTURA',
      'CORRECCION_SEGURIDAD_SOCIAL'
    );

  IF orphan_count > 0 THEN
    RAISE NOTICE '054: % fila(s) con código no reconocido — constraint aplicado igualmente; esas filas tendrán que corregirse manualmente.', orphan_count;
  END IF;
END $$;

-- ── 3. Recrear constraint con los 15 tipos oficiales ─────────────────────────
DO $$
BEGIN
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
        'CAMBIO_OPERATIVO_COBERTURA',
        'CORRECCION_SEGURIDAD_SOCIAL'
      ])
    );
  RAISE NOTICE '054: chk_novelty_type recreado con 15 tipos (incluye CORRECCION_SEGURIDAD_SOCIAL).';
END $$;

COMMIT;
