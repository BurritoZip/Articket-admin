-- ============================================================
-- 예매 의사(intent) 기록 — "예매하셨나요?" 확인 CTA
-- ============================================================
-- 배경:
--   공연 상세의 '예매하기'는 외부 예매처로 나가는 링크라, 사용자가 실제로 예매를
--   마쳤는지 앱이 알 수 없다. 돌아온 뒤 홈에서 되물어 확정한다.
--
-- 왜 user_bookings 에 pending 행을 넣지 않는가:
--   user_bookings 는 "확정된 예매"를 뜻하며 마이페이지 목록·연간 통계·아티스트
--   랭킹·타임테이블이 모두 이 테이블을 집계한다. 아직 예매 여부가 불확실한 행을
--   섞으면 그 지표들이 전부 오염된다. 그래서 의사 기록은 별도 테이블로 분리하고,
--   사용자가 '예'로 확정한 시점에만 user_bookings 에 completed 행을 만든다.

CREATE TABLE IF NOT EXISTS booking_intents (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id     UUID NOT NULL REFERENCES events(id)     ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  -- NULL = 아직 묻지 않았거나 미응답 / 'booked' = 예매함 / 'skipped' = 안 함
  outcome      TEXT CHECK (outcome IN ('booked', 'skipped')),
  PRIMARY KEY (user_id, event_id)
);

COMMENT ON TABLE  booking_intents            IS '외부 예매처로 나간 기록 — 복귀 후 예매 여부 확인 CTA용';
COMMENT ON COLUMN booking_intents.outcome    IS 'NULL=미응답 / booked=예매함 / skipped=안 함';
COMMENT ON COLUMN booking_intents.attempted_at IS '예매하기 탭 시각. 7일 지난 미응답 건은 앱이 조회에서 제외한다';

-- 미응답 건 조회 전용 인덱스 (홈 진입마다 호출되는 경로)
CREATE INDEX IF NOT EXISTS idx_booking_intents_pending
  ON booking_intents (user_id, attempted_at DESC)
  WHERE outcome IS NULL;

-- RLS: 본인 행만 읽고 쓴다.
-- FOR ALL + USING 만 지정하면 WITH CHECK 에도 같은 식이 적용되어 INSERT/UPDATE 까지 커버된다
-- (user_bookings 의 owner_only 정책과 동일한 방식).
ALTER TABLE booking_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_intents_owner_only" ON booking_intents;
CREATE POLICY "booking_intents_owner_only" ON booking_intents
  FOR ALL
  USING (auth.uid() = user_id);
