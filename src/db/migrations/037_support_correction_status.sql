-- Migration 037: Add 'correccion_solicitada' to novelty_supports status constraint
ALTER TABLE novelty_supports DROP CONSTRAINT IF EXISTS novelty_supports_status_check;
ALTER TABLE novelty_supports
  ADD CONSTRAINT novelty_supports_status_check
  CHECK (status IN ('pendiente','cargado','aprobado','rechazado','correccion_solicitada'));
