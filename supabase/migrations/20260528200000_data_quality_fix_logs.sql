CREATE TABLE IF NOT EXISTS data_quality_fix_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT        NOT NULL CHECK (entity_type IN ('venue', 'artist', 'event')),
  entity_id   UUID        NOT NULL,
  field_name  TEXT        NOT NULL,
  issue_type  TEXT        NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  fix_method  TEXT        NOT NULL CHECK (fix_method IN ('null_field', 'queued_ai')),
  fixed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dq_fix_logs_entity
  ON data_quality_fix_logs (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_dq_fix_logs_fixed_at
  ON data_quality_fix_logs (fixed_at DESC);

CREATE INDEX IF NOT EXISTS idx_dq_fix_logs_issue_type
  ON data_quality_fix_logs (issue_type);
