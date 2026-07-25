-- 이름 canonical 교정 검토큐 (admin-only, iOS 반영 불필요).
-- enrich(Gemini)가 현재 name 에 없는 "새 텍스트" 표시명을 제안하면 여기에 쌓고,
-- 운영자가 admin 에서 승인해야 artists.name 이 바뀐다.
-- 안전건(제안명이 현재 name 의 조각인 경우)은 큐를 거치지 않고 자동 적용된다.
--
-- name_proposal_meta 형태:
--   { "name_en": "...", "aliases": ["..."], "country": "...", "reason": "...", "source": "gemini", "proposed_at": "ISO" }

ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS name_proposal TEXT,
  ADD COLUMN IF NOT EXISTS name_proposal_meta JSONB;

CREATE INDEX IF NOT EXISTS idx_artists_name_proposal
  ON artists (name_proposal)
  WHERE name_proposal IS NOT NULL;
