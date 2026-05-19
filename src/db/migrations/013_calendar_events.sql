-- Calendar events for the dashboard sidebar
CREATE TABLE IF NOT EXISTS calendar_events (
  id          SERIAL      PRIMARY KEY,
  title       VARCHAR(80) NOT NULL,
  event_date  DATE        NOT NULL,
  event_time  TIME        DEFAULT NULL,
  description VARCHAR(120) DEFAULT NULL,
  company_id  INTEGER     REFERENCES companies(id) ON DELETE SET NULL,
  created_by  VARCHAR(80),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events (event_date ASC);
