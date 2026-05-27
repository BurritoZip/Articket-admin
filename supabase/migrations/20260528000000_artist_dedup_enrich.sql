-- ============================================================
-- 아티스트 중복 탐지·머지 + 외부 소스 보강 스키마
-- ============================================================

-- 1. artists 테이블 컬럼 추가
ALTER TABLE artists ADD COLUMN IF NOT EXISTS name_en TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT 'pending'
  CHECK (enrichment_status IN ('pending','in_progress','enriched','failed','skipped'));
ALTER TABLE artists ADD COLUMN IF NOT EXISTS enrichment_attempted_at TIMESTAMPTZ;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS enrichment_sources JSONB DEFAULT '{}';

-- 2. 인덱스
CREATE INDEX IF NOT EXISTS idx_artists_name_en
  ON artists (LOWER(name_en)) WHERE name_en IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_artists_enrichment_status
  ON artists (enrichment_status);

-- alias 검색 성능 향상
CREATE INDEX IF NOT EXISTS idx_artist_aliases_alias_lower
  ON artist_aliases (LOWER(alias));

-- normalized_name 대소문자 무시 검색
CREATE INDEX IF NOT EXISTS idx_artists_normalized_name_lower
  ON artists (LOWER(normalized_name)) WHERE normalized_name IS NOT NULL;

-- 3. 머지 감사 로그 테이블
CREATE TABLE IF NOT EXISTS artist_merge_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keep_artist_id   UUID,                  -- 살아남은 아티스트 (FK 없음 — 머지 후도 유지)
  merged_artist_id UUID,                  -- 삭제된 아티스트 (FK 없음 — 이미 삭제됨)
  merged_snapshot  JSONB NOT NULL,        -- 머지 직전 merged row 전체 (복구용)
  fk_reassignments JSONB NOT NULL,        -- {"event_artists": 3, "timetable_performances": 1, ...}
  performed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artist_merge_logs_keep
  ON artist_merge_logs (keep_artist_id);
CREATE INDEX IF NOT EXISTS idx_artist_merge_logs_performed_at
  ON artist_merge_logs (performed_at DESC);
