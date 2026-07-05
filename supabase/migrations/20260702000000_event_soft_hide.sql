-- 옛날 공연 소프트 숨김 — 하드 삭제 대신 is_hidden 플래그로 앱 노출만 차단(이력 보존, 되돌림 가능).
-- 파이프라인 'purge' 단계가 status='ended' & end_date 가 임계일수(기본 180일) 지난 공연을 숨긴다.
-- iOS/앱은 is_hidden=false 만 조회한다.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

-- 앱 목록 조회(노출 대상)의 주 필터 — 부분 인덱스로 노출 공연만 인덱싱.
CREATE INDEX IF NOT EXISTS idx_events_visible
  ON events (start_date DESC)
  WHERE is_hidden = false;

-- purge 임계 판정용 — ended & 오래된 공연 스캔 가속.
CREATE INDEX IF NOT EXISTS idx_events_ended_end_date
  ON events (end_date)
  WHERE status = 'ended' AND is_hidden = false;

-- 파이프라인 단계 시드 보강 — score/purge 는 초기 마이그레이션(6단계) 이후 추가됨.
INSERT INTO pipeline_step_status (step_name) VALUES
  ('score'),
  ('purge')
ON CONFLICT (step_name) DO NOTHING;
