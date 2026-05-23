ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS normalized_full_name TEXT;

UPDATE employees
SET normalized_full_name = TRIM(REGEXP_REPLACE(
  REGEXP_REPLACE(
    TRANSLATE(
      UPPER(COALESCE(full_name, '')),
      'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
      'AAAAAAEEEEIIIIOOOOOUUUUNC'
    ),
    '[-_]+',
    ' ',
    'g'
  ),
  '[^A-Z0-9 ]+',
  ' ',
  'g'
))
WHERE normalized_full_name IS NULL OR normalized_full_name = '';

UPDATE employees
SET normalized_full_name = REGEXP_REPLACE(normalized_full_name, '\s+', ' ', 'g')
WHERE normalized_full_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_normalized_full_name
  ON employees(normalized_full_name);

CREATE OR REPLACE FUNCTION set_employee_normalized_full_name()
RETURNS trigger AS $$
BEGIN
  NEW.normalized_full_name := REGEXP_REPLACE(
    TRIM(REGEXP_REPLACE(
      REGEXP_REPLACE(
        TRANSLATE(
          UPPER(COALESCE(NEW.full_name, '')),
          'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
          'AAAAAAEEEEIIIIOOOOOUUUUNC'
        ),
        '[-_]+',
        ' ',
        'g'
      ),
      '[^A-Z0-9 ]+',
      ' ',
      'g'
    )),
    '\s+',
    ' ',
    'g'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employee_normalized_full_name ON employees;

CREATE TRIGGER trg_employee_normalized_full_name
BEFORE INSERT OR UPDATE OF full_name ON employees
FOR EACH ROW
EXECUTE FUNCTION set_employee_normalized_full_name();
