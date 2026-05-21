-- Módulo de Inventario de Dotación

CREATE TABLE IF NOT EXISTS dotacion_catalogo (
  id                  SERIAL PRIMARY KEY,
  nombre              VARCHAR(120) NOT NULL,
  categoria           VARCHAR(60),
  descripcion         TEXT,
  requiere_talla      BOOLEAN NOT NULL DEFAULT false,
  periodicidad_meses  INTEGER,
  activo              BOOLEAN NOT NULL DEFAULT true,
  company_id          INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contract_id         INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dotacion_stock (
  id                   SERIAL PRIMARY KEY,
  catalogo_id          INTEGER NOT NULL REFERENCES dotacion_catalogo(id) ON DELETE CASCADE,
  talla                VARCHAR(20),
  cantidad_disponible  INTEGER NOT NULL DEFAULT 0,
  company_id           INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contract_id          INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dotacion_asignaciones (
  id                  SERIAL PRIMARY KEY,
  employee_id         INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  catalogo_id         INTEGER NOT NULL REFERENCES dotacion_catalogo(id) ON DELETE RESTRICT,
  talla               VARCHAR(20),
  cantidad            INTEGER NOT NULL DEFAULT 1,
  fecha_entrega       DATE,
  fecha_recibido      DATE,
  fecha_vencimiento   DATE,
  condicion           VARCHAR(30) NOT NULL DEFAULT 'NUEVA',
  estado              VARCHAR(30) NOT NULL DEFAULT 'ASIGNADA',
  evidencia           TEXT,
  observaciones       TEXT,
  company_id          INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contract_id         INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  created_by          INTEGER,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dotacion_stock_catalogo ON dotacion_stock(catalogo_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dotacion_stock_uniq_sin_talla ON dotacion_stock(catalogo_id) WHERE talla IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dotacion_stock_uniq_con_talla ON dotacion_stock(catalogo_id, talla) WHERE talla IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dotacion_asig_employee ON dotacion_asignaciones(employee_id);
CREATE INDEX IF NOT EXISTS idx_dotacion_asig_company_contract ON dotacion_asignaciones(company_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_dotacion_catalogo_company_contract ON dotacion_catalogo(company_id, contract_id);
