ALTER TABLE data_quality_fix_logs
  DROP CONSTRAINT IF EXISTS data_quality_fix_logs_fix_method_check;

ALTER TABLE data_quality_fix_logs
  ADD CONSTRAINT data_quality_fix_logs_fix_method_check
  CHECK (fix_method IN ('null_field', 'queued_ai', 'deleted'));
