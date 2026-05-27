-- ============================================================
-- Articket Ingestion System — Operational Tables
-- ============================================================

-- events 테이블 컬럼 확장
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS dedup_key         TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS source_urls       TEXT[],
  ADD COLUMN IF NOT EXISTS crawled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS normalized_title  TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload       JSONB,
  ADD COLUMN IF NOT EXISTS source_name       TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_crawler BOOLEAN DEFAULT FALSE;

-- artists 테이블 컬럼 확장
ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS normalized_name   TEXT,
  ADD COLUMN IF NOT EXISTS metadata          JSONB;

-- venues 테이블 컬럼 확장
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS normalized_name   TEXT,
  ADD COLUMN IF NOT EXISTS latitude          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude         DOUBLE PRECISION;

-- ============================================================
-- crawler_sources: 크롤러 소스 등록
-- ============================================================
CREATE TABLE IF NOT EXISTS crawler_sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,        -- 'stagepick', 'interpark', etc.
  display_name TEXT NOT NULL,
  base_url     TEXT NOT NULL,
  enabled      BOOLEAN DEFAULT TRUE,
  config       JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- crawler_jobs: 크롤러 실행 이력
-- ============================================================
CREATE TABLE IF NOT EXISTS crawler_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','success','failed','partial')),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  pages_crawled   INT DEFAULT 0,
  events_found    INT DEFAULT 0,
  events_upserted INT DEFAULT 0,
  events_skipped  INT DEFAULT 0,
  error_count     INT DEFAULT 0,
  meta            JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- crawler_jobs가 이미 존재할 경우 필요한 컬럼 추가
ALTER TABLE crawler_jobs ADD COLUMN IF NOT EXISTS source_name     TEXT NOT NULL DEFAULT '';
ALTER TABLE crawler_jobs ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE crawler_jobs ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ;
ALTER TABLE crawler_jobs ADD COLUMN IF NOT EXISTS finished_at     TIMESTAMPTZ;
ALTER TABLE crawler_jobs ADD COLUMN IF NOT EXISTS pages_crawled   INT DEFAULT 0;
ALTER TABLE crawler_jobs ADD COLUMN IF NOT EXISTS events_found    INT DEFAULT 0;
ALTER TABLE crawler_jobs ADD COLUMN IF NOT EXISTS events_upserted INT DEFAULT 0;
ALTER TABLE crawler_jobs ADD COLUMN IF NOT EXISTS events_skipped  INT DEFAULT 0;
ALTER TABLE crawler_jobs ADD COLUMN IF NOT EXISTS error_count     INT DEFAULT 0;
ALTER TABLE crawler_jobs ADD COLUMN IF NOT EXISTS meta            JSONB DEFAULT '{}';
ALTER TABLE crawler_jobs ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_crawler_jobs_source ON crawler_jobs(source_name);
CREATE INDEX IF NOT EXISTS idx_crawler_jobs_status ON crawler_jobs(status);
CREATE INDEX IF NOT EXISTS idx_crawler_jobs_created ON crawler_jobs(created_at DESC);

-- ============================================================
-- raw_event_payloads: 원본 크롤링 데이터 (절대 삭제 금지)
-- ============================================================
CREATE TABLE IF NOT EXISTS raw_event_payloads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID REFERENCES crawler_jobs(id) ON DELETE SET NULL,
  source_name  TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  raw_html     TEXT,
  parsed_json  JSONB,
  crawled_at   TIMESTAMPTZ DEFAULT NOW(),
  dedup_key    TEXT,
  processed    BOOLEAN DEFAULT FALSE,
  event_id     UUID REFERENCES events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_payloads_job    ON raw_event_payloads(job_id);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_source ON raw_event_payloads(source_name);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_dedup  ON raw_event_payloads(dedup_key);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_proc   ON raw_event_payloads(processed);

-- ============================================================
-- event_change_logs: 이벤트 변경 추적
-- ============================================================
CREATE TABLE IF NOT EXISTS event_change_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  job_id      UUID REFERENCES crawler_jobs(id) ON DELETE SET NULL,
  field_name  TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_logs_event ON event_change_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_change_logs_time  ON event_change_logs(changed_at DESC);

-- ============================================================
-- artist_aliases: 아티스트 별명/표기 변형
-- ============================================================
CREATE TABLE IF NOT EXISTS artist_aliases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id   UUID REFERENCES artists(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,
  source      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (artist_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_artist_aliases_alias ON artist_aliases(alias);

-- ============================================================
-- event_timetable_assets: 타임테이블 이미지/파일 원본
-- ============================================================
CREATE TABLE IF NOT EXISTS event_timetable_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID REFERENCES events(id) ON DELETE CASCADE,
  asset_url     TEXT NOT NULL,
  asset_type    TEXT DEFAULT 'image' CHECK (asset_type IN ('image','pdf','html')),
  ocr_status    TEXT DEFAULT 'pending'
                  CHECK (ocr_status IN ('pending','processing','done','failed','skipped')),
  ocr_raw_text  TEXT,
  ocr_parsed    JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timetable_assets_event  ON event_timetable_assets(event_id);
CREATE INDEX IF NOT EXISTS idx_timetable_assets_status ON event_timetable_assets(ocr_status);

-- ============================================================
-- ingestion_errors: 크롤링/파싱/저장 오류 로그
-- ============================================================
CREATE TABLE IF NOT EXISTS ingestion_errors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID REFERENCES crawler_jobs(id) ON DELETE SET NULL,
  source_name  TEXT NOT NULL,
  source_url   TEXT,
  step         TEXT NOT NULL
                 CHECK (step IN ('crawl','parse','normalize','match','upsert','ai')),
  error_type   TEXT,
  error_message TEXT,
  stack_trace  TEXT,
  raw_payload  JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_errors_job    ON ingestion_errors(job_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_errors_source ON ingestion_errors(source_name);
CREATE INDEX IF NOT EXISTS idx_ingestion_errors_step   ON ingestion_errors(step);
CREATE INDEX IF NOT EXISTS idx_ingestion_errors_time   ON ingestion_errors(created_at DESC);

-- ============================================================
-- ai_processing_queue: AI 비동기 작업 큐
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_processing_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type    TEXT NOT NULL
                 CHECK (task_type IN (
                   'normalize_venue','deduplicate_artist','ocr_timetable',
                   'parse_dates','classify_genre','summarize_event',
                   'detect_duplicates','match_artist','clean_data'
                 )),
  status       TEXT DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','done','failed','skipped')),
  priority     INT DEFAULT 5,
  payload      JSONB NOT NULL,
  result       JSONB,
  error        TEXT,
  attempts     INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  entity_type  TEXT,
  entity_id    UUID
);

CREATE INDEX IF NOT EXISTS idx_ai_queue_status   ON ai_processing_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_ai_queue_type     ON ai_processing_queue(task_type);
CREATE INDEX IF NOT EXISTS idx_ai_queue_created  ON ai_processing_queue(created_at);

-- ============================================================
-- automation_runs: AI/자동화 실행 이력
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type     TEXT NOT NULL,
  status       TEXT DEFAULT 'running'
                 CHECK (status IN ('running','success','failed')),
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  items_processed INT DEFAULT 0,
  items_changed   INT DEFAULT 0,
  summary      JSONB DEFAULT '{}',
  triggered_by TEXT DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_type   ON automation_runs(run_type);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON automation_runs(status);

-- ============================================================
-- event_merge_candidates: 중복 이벤트 병합 후보
-- ============================================================
CREATE TABLE IF NOT EXISTS event_merge_candidates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id_a   UUID REFERENCES events(id) ON DELETE CASCADE,
  event_id_b   UUID REFERENCES events(id) ON DELETE CASCADE,
  similarity   FLOAT,
  reason       TEXT,
  status       TEXT DEFAULT 'pending'
                 CHECK (status IN ('pending','merged','rejected','reviewed')),
  reviewed_by  UUID,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (event_id_a, event_id_b)
);

-- ============================================================
-- 초기 데이터: StagePick 소스 등록
-- ============================================================
INSERT INTO crawler_sources (name, display_name, base_url, enabled, config)
VALUES (
  'stagepick',
  'StagePick',
  'https://www.stagepick.co.kr',
  TRUE,
  '{"listPath": "/festival", "rateLimit": 1500}'
)
ON CONFLICT (name) DO NOTHING;
