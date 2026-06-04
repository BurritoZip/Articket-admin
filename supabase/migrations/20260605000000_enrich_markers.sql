-- 토큰 절약 — Gemini 보강 "이미 시도함" 마커.
-- 마커가 없어 매 파이프라인 실행마다 같은 항목을 재호출하던 낭비를 막는다.
--   ticket_checked_at: 예매일 그라운딩 1회 시도 후 기록(못 찾아도) → 재그라운딩 방지
--   age_checked_at   : 연령 추론 1회 시도 후 기록
--   gemini_checked_at: 아티스트 Gemini 보강(통합) 1회 시도 후 기록
--   gemini_canon     : 아티스트 표준 canonical 키 저장 → dedup이 Gemini 없이 그룹핑
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS ticket_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS age_checked_at TIMESTAMPTZ;

ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS gemini_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gemini_canon TEXT;

-- 이미 채워진 것은 시도한 것으로 간주(불필요 재호출 방지)
UPDATE events SET ticket_checked_at = now() WHERE ticket_open_date IS NOT NULL;
UPDATE events SET age_checked_at = now() WHERE age_restriction IS NOT NULL;
UPDATE artists SET gemini_checked_at = now() WHERE description IS NOT NULL;
