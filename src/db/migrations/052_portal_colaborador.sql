-- 052_portal_colaborador.sql
-- Módulo Portal del Colaborador: soportes, tickets, notificaciones, auditoría

-- ── Soportes del portal ───────────────────────────────────────────────────────
-- El gestor carga soportes de empleados; Talento Humano aprueba o rechaza.
CREATE TABLE IF NOT EXISTS portal_soportes (
  id                  SERIAL        PRIMARY KEY,
  employee_id         BIGINT,
  employee_name       VARCHAR(255),
  document_number     VARCHAR(50),
  municipality_id     INT,
  municipality_name   VARCHAR(255),
  company_id          INT,
  contract_id         INT,
  doc_type            VARCHAR(150),
  deadline            DATE,
  file_url            VARCHAR(500),
  file_name           VARCHAR(255),
  status              VARCHAR(30)   NOT NULL DEFAULT 'PENDIENTE',
  observation         TEXT,
  created_by_user_id  INT,
  created_by_name     VARCHAR(255),
  updated_by_user_id  INT,
  updated_by_name     VARCHAR(255),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_portal_soportes_status CHECK (
    status IN ('PENDIENTE','EN_REVISION','APROBADO','RECHAZADO')
  )
);

CREATE INDEX IF NOT EXISTS idx_portal_soportes_status         ON portal_soportes(status);
CREATE INDEX IF NOT EXISTS idx_portal_soportes_municipality   ON portal_soportes(municipality_id);
CREATE INDEX IF NOT EXISTS idx_portal_soportes_employee       ON portal_soportes(employee_id);
CREATE INDEX IF NOT EXISTS idx_portal_soportes_created_at     ON portal_soportes(created_at DESC);

-- ── Consecutivo para tickets ──────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS portal_ticket_seq START 1;

-- ── Tickets (solicitudes no automáticas) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_tickets (
  id                  SERIAL        PRIMARY KEY,
  ticket_number       VARCHAR(25)   UNIQUE,
  employee_id         BIGINT,
  employee_name       VARCHAR(255),
  document_number     VARCHAR(50),
  municipality_id     INT,
  municipality_name   VARCHAR(255),
  company_id          INT,
  contract_id         INT,
  ticket_type         VARCHAR(50)   NOT NULL,
  -- RECLAMACION_NOMINA
  period              VARCHAR(20),
  motivo              VARCHAR(255),
  -- RECLAMACION_TURNOS
  fecha_turno         DATE,
  turno_referencia    VARCHAR(100),
  valor_esperado      NUMERIC(12,2),
  -- común
  descripcion         TEXT,
  attachment_url      VARCHAR(500),
  status              VARCHAR(30)   NOT NULL DEFAULT 'RADICADA',
  response_text       TEXT,
  created_by_user_id  INT,
  created_by_name     VARCHAR(255),
  assigned_to_user_id INT,
  assigned_to_name    VARCHAR(255),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ,
  CONSTRAINT chk_portal_tickets_type CHECK (
    ticket_type IN (
      'RECLAMACION_NOMINA','RECLAMACION_TURNOS',
      'ACTUALIZACION_DATOS','OTRO'
    )
  ),
  CONSTRAINT chk_portal_tickets_status CHECK (
    status IN ('RADICADA','EN_PROCESO','RESPONDIDA','CERRADA')
  )
);

CREATE INDEX IF NOT EXISTS idx_portal_tickets_status       ON portal_tickets(status);
CREATE INDEX IF NOT EXISTS idx_portal_tickets_type         ON portal_tickets(ticket_type);
CREATE INDEX IF NOT EXISTS idx_portal_tickets_municipality ON portal_tickets(municipality_id);
CREATE INDEX IF NOT EXISTS idx_portal_tickets_employee     ON portal_tickets(employee_id);
CREATE INDEX IF NOT EXISTS idx_portal_tickets_created_at   ON portal_tickets(created_at DESC);

-- Trigger: asigna el consecutivo automáticamente al insertar
CREATE OR REPLACE FUNCTION fn_set_portal_ticket_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ticket_number IS NULL THEN
    NEW.ticket_number := 'SOL-' ||
      EXTRACT(YEAR FROM NOW())::TEXT || '-' ||
      LPAD(nextval('portal_ticket_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_ticket_number ON portal_tickets;
CREATE TRIGGER trg_portal_ticket_number
  BEFORE INSERT ON portal_tickets
  FOR EACH ROW EXECUTE FUNCTION fn_set_portal_ticket_number();

-- ── Documentos automáticos enviados ──────────────────────────────────────────
-- Registra cada vez que se genera y envía un documento automático por email.
CREATE TABLE IF NOT EXISTS portal_doc_delivery (
  id                  SERIAL        PRIMARY KEY,
  employee_id         BIGINT,
  employee_name       VARCHAR(255),
  email               VARCHAR(255),
  doc_type            VARCHAR(60)   NOT NULL,
  doc_period          VARCHAR(20),
  status              VARCHAR(20)   NOT NULL DEFAULT 'ENVIADO',
  error_message       TEXT,
  created_by_user_id  INT,
  created_by_name     VARCHAR(255),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_portal_doc_delivery_status CHECK (
    status IN ('ENVIADO','ERROR')
  )
);

CREATE INDEX IF NOT EXISTS idx_portal_doc_delivery_employee ON portal_doc_delivery(employee_id);
CREATE INDEX IF NOT EXISTS idx_portal_doc_delivery_type     ON portal_doc_delivery(doc_type);

-- ── Notificaciones del portal ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_notifications (
  id                SERIAL        PRIMARY KEY,
  user_id           INT           NOT NULL,
  title             VARCHAR(255)  NOT NULL,
  body              TEXT,
  notification_type VARCHAR(60),
  reference_type    VARCHAR(50),
  reference_id      INT,
  read              BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_notifications_user_read ON portal_notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_portal_notifications_created   ON portal_notifications(created_at DESC);

-- ── Auditoría del portal ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_audit_log (
  id           SERIAL        PRIMARY KEY,
  user_id      INT,
  user_name    VARCHAR(255),
  action       VARCHAR(100)  NOT NULL,
  entity_type  VARCHAR(50),
  entity_id    INT,
  result       VARCHAR(50),
  observation  TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_audit_entity  ON portal_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_portal_audit_user    ON portal_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_portal_audit_created ON portal_audit_log(created_at DESC);
