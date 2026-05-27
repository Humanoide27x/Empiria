-- ─────────────────────────────────────────────────────────────────────────────
-- 035 — Corregir chk_novelty_type en payroll_novelties
--
-- El constraint original permitía códigos legacy (INCAPACIDAD, VACACIONES…)
-- incompatibles con el flujo operativo (029+). Se elimina y se reemplaza
-- con la lista canónica de 13 tipos oficiales de EMPIRIA.
--
-- Seguro ante datos legacy: si existen filas con códigos fuera de la lista
-- nueva se emite un NOTICE y no se agrega el nuevo constraint (la validación
-- queda a cargo del backend). La migración nunca falla.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  legacy_count INTEGER;
BEGIN
  -- 1. Eliminar constraint viejo si existe
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_novelty_type'
      AND conrelid = 'payroll_novelties'::regclass
  ) THEN
    ALTER TABLE payroll_novelties DROP CONSTRAINT chk_novelty_type;
    RAISE NOTICE '035: chk_novelty_type anterior eliminado.';
  END IF;

  -- 2. Detectar filas con códigos que no pertenecen al nuevo catálogo
  SELECT COUNT(*) INTO legacy_count
  FROM payroll_novelties
  WHERE novelty_type IS NOT NULL
    AND novelty_type NOT IN (
      'DIAS_NO_CLASE',
      'CITA_MEDICA',
      'INCAPACIDAD_MEDICA',
      'INCAPACIDAD_ACCIDENTE_LABORAL',
      'CALAMIDAD_FAMILIAR',
      'LUTO',
      'PERMISOS_NO_REMUNERADOS',
      'CITACION_COLEGIO',
      'LICENCIA_MATERNIDAD_PATERNIDAD',
      'SUSPENSION',
      'FECHA_INGRESO',
      'FECHA_RETIRO',
      'CAMBIO_OPERATIVO_COBERTURA'
    );

  IF legacy_count > 0 THEN
    RAISE NOTICE '035: % fila(s) legacy detectada(s). Constraint no re-aplicado — validación delegada al backend.', legacy_count;
  ELSE
    -- 3. Agregar nuevo constraint solo si no hay conflictos
    ALTER TABLE payroll_novelties
      ADD CONSTRAINT chk_novelty_type CHECK (
        novelty_type IS NULL OR novelty_type = ANY (ARRAY[
          'DIAS_NO_CLASE',
          'CITA_MEDICA',
          'INCAPACIDAD_MEDICA',
          'INCAPACIDAD_ACCIDENTE_LABORAL',
          'CALAMIDAD_FAMILIAR',
          'LUTO',
          'PERMISOS_NO_REMUNERADOS',
          'CITACION_COLEGIO',
          'LICENCIA_MATERNIDAD_PATERNIDAD',
          'SUSPENSION',
          'FECHA_INGRESO',
          'FECHA_RETIRO',
          'CAMBIO_OPERATIVO_COBERTURA'
        ])
      );
    RAISE NOTICE '035: Nuevo chk_novelty_type aplicado con 13 tipos operativos.';
  END IF;
END $$;
