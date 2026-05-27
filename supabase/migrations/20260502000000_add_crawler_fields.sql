-- =====================================================
-- 크롤러 파이프라인 지원 필드 추가
-- =====================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS dedup_key  TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS source_urls JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS crawled_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_events_dedup_key ON events(dedup_key)
  WHERE dedup_key IS NOT NULL;

-- 아티스트 이름 중복 방지 (크롤러 UPSERT 대상)
CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_name_unique ON artists(name);

-- 공연장 이름+주소 중복 방지 (크롤러 UPSERT 대상)
CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_name_address_unique ON venues(name, address);
