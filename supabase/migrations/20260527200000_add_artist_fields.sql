-- ============================================================
-- Artist 추가 필드: 소속사, 국가, SNS 링크
-- ============================================================

ALTER TABLE artists ADD COLUMN IF NOT EXISTS label   TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS country  TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS sns_links JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN artists.label     IS '소속사 / 레이블';
COMMENT ON COLUMN artists.country   IS '국가 (예: KR, US)';
COMMENT ON COLUMN artists.sns_links IS 'SNS 링크 JSON {spotify, apple_music, youtube, instagram, twitter}';
