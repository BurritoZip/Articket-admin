CREATE TABLE IF NOT EXISTS pipeline_step_status (
  step_name   TEXT        PRIMARY KEY,
  status      TEXT        NOT NULL DEFAULT 'idle'
                CHECK (status IN ('idle','running','done','failed')),
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  result      JSONB,
  error       TEXT
);

-- 6단계 초기화
INSERT INTO pipeline_step_status (step_name) VALUES
  ('crawl'),
  ('sweep'),
  ('fix'),
  ('delete'),
  ('enrich'),
  ('merge')
ON CONFLICT (step_name) DO NOTHING;
