-- crawler_jobs.source 컬럼을 nullable로 변경 (source_name으로 통합)
ALTER TABLE crawler_jobs ALTER COLUMN source DROP NOT NULL;
