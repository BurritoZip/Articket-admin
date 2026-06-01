-- ============================================================
-- 공연장 주소 보강 시도 마킹 — 재선택 방지(진도 보장)
-- ============================================================
-- events.enrich_attempted_at 와 동일 패턴. 주소를 못 찾은 공연장이 매 run 같은 배치로
-- 재선택되어 백로그(543건)가 줄지 않던 문제 해결.
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS address_attempted_at TIMESTAMPTZ;

-- 보강 대상 선택 쿼리 인덱스
CREATE INDEX IF NOT EXISTS idx_venues_address_pending
  ON venues (address_attempted_at)
  WHERE address IS NULL OR address = '';
