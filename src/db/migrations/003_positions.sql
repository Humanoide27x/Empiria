-- ════════════════════════════════════════════════════════
-- Módulo: Configuración de Cargos, Perfiles y Nómina
-- ════════════════════════════════════════════════════════

-- Función reutilizable para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ── Tabla principal de cargos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS positions (
  id               SERIAL PRIMARY KEY,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  contract_id      INTEGER REFERENCES contracts(id),
  name             TEXT    NOT NULL,
  area             TEXT,
  profile_level    TEXT,
  position_type    TEXT,
  category         TEXT    CHECK (category IN ('OFERTA','EXTRA','ADMINISTRATIVO','OPERATIVO','PROFESIONAL')),
  applies_coverage BOOLEAN NOT NULL DEFAULT false,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_by       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS positions_company_idx  ON positions(company_id);
CREATE INDEX IF NOT EXISTS positions_contract_idx ON positions(contract_id);
CREATE INDEX IF NOT EXISTS positions_active_idx   ON positions(active);

DROP TRIGGER IF EXISTS positions_updated_at ON positions;
CREATE TRIGGER positions_updated_at
  BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Perfil del cargo (1:1) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS position_profiles (
  id               SERIAL PRIMARY KEY,
  position_id      INTEGER NOT NULL UNIQUE REFERENCES positions(id) ON DELETE CASCADE,
  objective        TEXT,
  main_functions   TEXT,
  education_req    TEXT,
  min_experience   TEXT,
  certifications   TEXT,
  responsibilities TEXT,
  observations     TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS position_profiles_updated_at ON position_profiles;
CREATE TRIGGER position_profiles_updated_at
  BEFORE UPDATE ON position_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Valores de nómina por cargo (1:N — vigencias) ────────────────────────────
CREATE TABLE IF NOT EXISTS position_payroll_values (
  id                      SERIAL PRIMARY KEY,
  position_id             INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  base_salary             NUMERIC NOT NULL DEFAULT 0,
  transport_allowance     NUMERIC NOT NULL DEFAULT 0,
  salary_type             TEXT    NOT NULL DEFAULT 'mensual'
                          CHECK (salary_type IN ('mensual','diario','por_hora','prestacion_servicios')),
  day_value               NUMERIC,
  hour_value              NUMERIC,
  fixed_bonus             NUMERIC NOT NULL DEFAULT 0,
  sunday_surcharge        NUMERIC NOT NULL DEFAULT 0,
  applies_benefits        BOOLEAN NOT NULL DEFAULT true,
  applies_social_security BOOLEAN NOT NULL DEFAULT true,
  valid_from              DATE,
  valid_until             DATE,
  active                  BOOLEAN NOT NULL DEFAULT true,
  notes                   TEXT,
  created_by              INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ppv_position_idx ON position_payroll_values(position_id);
CREATE INDEX IF NOT EXISTS ppv_active_idx   ON position_payroll_values(active);

DROP TRIGGER IF EXISTS ppv_updated_at ON position_payroll_values;
CREATE TRIGGER ppv_updated_at
  BEFORE UPDATE ON position_payroll_values
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Documentos requeridos por cargo ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS position_document_requirements (
  id               SERIAL PRIMARY KEY,
  position_id      INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  document_type_id INTEGER NOT NULL,
  required         BOOLEAN NOT NULL DEFAULT true,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(position_id, document_type_id)
);

CREATE INDEX IF NOT EXISTS pdr_position_idx ON position_document_requirements(position_id);
