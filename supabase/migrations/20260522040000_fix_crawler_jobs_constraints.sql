-- crawler_jobs status constraint 재정의 (partial 추가)
ALTER TABLE crawler_jobs DROP CONSTRAINT IF EXISTS crawler_jobs_status_check;
ALTER TABLE crawler_jobs ADD CONSTRAINT crawler_jobs_status_check
  CHECK (status IN ('pending', 'running', 'success', 'failed', 'partial'));
