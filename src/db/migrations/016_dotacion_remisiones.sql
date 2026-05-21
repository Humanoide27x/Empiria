-- Remisiones de envío de dotación

CREATE TABLE IF NOT EXISTS dotacion_remisiones (
  id           SERIAL PRIMARY KEY,
  numero       VARCHAR(40)  NOT NULL,
  fecha_envio  DATE         NOT NULL,
  sede_nombre  VARCHAR(200),
  modalidad    VARCHAR(60),
  responsable  VARCHAR(120),
  observaciones TEXT,
  estado       VARCHAR(30)  NOT NULL DEFAULT 'BORRADOR',
  foto_remision TEXT,
  company_id   INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contract_id  INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  created_by   INTEGER,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dotacion_remisiones_items (
  id                 SERIAL PRIMARY KEY,
  remision_id        INTEGER NOT NULL REFERENCES dotacion_remisiones(id) ON DELETE CASCADE,
  employee_nombre    VARCHAR(180),
  employee_documento VARCHAR(50),
  item_nombre        VARCHAR(120) NOT NULL,
  categoria          VARCHAR(60),
  talla              VARCHAR(20),
  cantidad           INTEGER NOT NULL DEFAULT 1,
  condicion          VARCHAR(30),
  observaciones      TEXT,
  orden              INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rem_company_contract ON dotacion_remisiones(company_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_rem_items_remision ON dotacion_remisiones_items(remision_id);
