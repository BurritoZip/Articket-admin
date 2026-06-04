-- 아티스트 한 줄 소개(description) 컬럼 추가
-- Gemini 그라운딩 보강이 채운다. 기존 enrich 필드 목록엔 없어 영원히 비어있던 정보.
ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS description TEXT;
