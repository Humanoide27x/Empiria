ALTER TABLE master_document_types
  ADD COLUMN IF NOT EXISTS default_expires BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_alert_days_before_expiration INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS validation_required BOOLEAN DEFAULT true;

UPDATE master_document_types
SET default_expires = false
WHERE default_expires IS NULL;

UPDATE master_document_types
SET default_alert_days_before_expiration = 30
WHERE default_alert_days_before_expiration IS NULL;

UPDATE master_document_types
SET validation_required = true
WHERE validation_required IS NULL;
