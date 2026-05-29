ALTER TABLE data_quality_fix_logs
  ADD COLUMN IF NOT EXISTS gemini_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS gemini_prompt    TEXT,
  ADD COLUMN IF NOT EXISTS error_msg        TEXT;
