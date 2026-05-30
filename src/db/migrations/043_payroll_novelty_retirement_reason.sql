-- Motivo de retiro para novedades FECHA_RETIRO
-- Determina si el puesto requiere reemplazo y cómo calcular los Días SS
ALTER TABLE payroll_novelties
  ADD COLUMN IF NOT EXISTS retirement_reason VARCHAR(50);
