-- =====================================================================
-- Extiende master_document_types con defaults operativos para la matriz
-- documental contractual sin romper reglas existentes ni historicos.
-- =====================================================================

ALTER TABLE master_document_types
  ADD COLUMN IF NOT EXISTS default_expires BOOLEAN,
  ADD COLUMN IF NOT EXISTS default_alert_days_before_expiration INTEGER;

UPDATE master_document_types
SET
  default_expires = COALESCE(default_expires, false),
  default_alert_days_before_expiration = CASE
    WHEN COALESCE(default_expires, false) = false THEN NULL
    ELSE COALESCE(default_alert_days_before_expiration, 30)
  END;

ALTER TABLE master_document_types
  ALTER COLUMN default_expires SET DEFAULT false,
  ALTER COLUMN default_expires SET NOT NULL;

ALTER TABLE master_document_types
  DROP CONSTRAINT IF EXISTS master_document_types_default_alert_days_ck;

ALTER TABLE master_document_types
  ADD CONSTRAINT master_document_types_default_alert_days_ck
  CHECK (
    default_alert_days_before_expiration IS NULL
    OR default_alert_days_before_expiration >= 0
  );

COMMENT ON COLUMN master_document_types.default_expires IS
  'Default sugerido para reglas contractuales nuevas creadas desde la matriz documental.';

COMMENT ON COLUMN master_document_types.default_alert_days_before_expiration IS
  'Dias de alerta sugeridos para reglas contractuales nuevas creadas desde la matriz documental.';
