-- 이벤트 자동 병합 / 미연결 정리의 비가역 삭제 제거
--
-- 문제:
--   1. lib/ingestion/event-auto-merge.ts 가 흡수 대상 행을 하드삭제한다.
--      - 삭제 행의 poster_url / ticket_* / genre / notice_text / venue_id 등은 canonical 로
--        이관되지 않아 그대로 소실된다.
--      - events 삭제는 CASCADE 라 concert_reviews, user_bookings, user_interested_events,
--        booking_intents, timetable_performances, event_artists, event_venues,
--        event_change_logs 까지 함께 삭제된다. 유저 데이터 포함.
--      - artist_merge_logs 같은 스냅샷이 없어 복구 불가.
--   2. lib/data-quality/purge-unlinked.ts 도 같은 이유로 하드삭제한다.
--
-- 조치: 하드삭제 → 소프트 병합/숨김 + 스냅샷 로그.
--   앱은 is_hidden=false 만 조회하므로(20260702000000_event_soft_hide.sql) 노출 결과는 동일하고,
--   FK 가 살아있어 유저 데이터가 보존되며 되돌릴 수 있다.

-- 흡수된 행이 어느 행으로 병합됐는지
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS merged_into_event_id UUID REFERENCES events(id) ON DELETE SET NULL;

COMMENT ON COLUMN events.merged_into_event_id IS
  '자동 병합으로 흡수된 행이 가리키는 canonical 이벤트. NOT NULL 이면 is_hidden=true 이며 앱에 노출되지 않는다.';

CREATE INDEX IF NOT EXISTS idx_events_merged_into
  ON events (merged_into_event_id)
  WHERE merged_into_event_id IS NOT NULL;

-- 병합 이력 (artist_merge_logs 와 같은 역할)
CREATE TABLE IF NOT EXISTS event_merge_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id UUID,                      -- 살아남은 이벤트 (FK 없음 — 이력 보존 우선)
  merged_event_id    UUID,                      -- 흡수된 이벤트
  pass_name          TEXT,                      -- 어느 병합 패스가 묶었는지 (오병합 추적용)
  snapshot           JSONB NOT NULL,            -- 병합 직전 흡수 행 전체 (복구용)
  transferred_fields TEXT[] NOT NULL DEFAULT '{}', -- canonical 의 빈 칸을 채운 필드 목록
  performed_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_merge_logs_canonical
  ON event_merge_logs (canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_event_merge_logs_merged
  ON event_merge_logs (merged_event_id);
CREATE INDEX IF NOT EXISTS idx_event_merge_logs_performed_at
  ON event_merge_logs (performed_at DESC);

ALTER TABLE event_merge_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 제목 KEEP/DROP 판정 캐시
--
-- 문제: lib/data-quality/classify-keep.ts 가 5개 스크래퍼 + purge 에서 호출되는데 캐시가 없어
--   **매 실행마다 크롤한 전체 제목을 재분류**한다. 실행당 ~42 Gemini 콜인데, 크롤 제목의 거의
--   전량이 지난 실행에서 이미 판정한 동일 제목이다. 전체 non-grounded 호출의 대부분이 여기서 난다.
-- 조치: 정규화 제목을 키로 판정을 영속화하고, 미판정 제목만 Gemini 에 보낸다.
CREATE TABLE IF NOT EXISTS title_keep_verdicts (
  title_key    TEXT PRIMARY KEY,          -- NFKC + 소문자 + 영숫자/한글만 남긴 제목
  verdict      TEXT NOT NULL CHECK (verdict IN ('keep', 'drop')),
  sample_title TEXT,                      -- 사람이 볼 원본 제목(디버깅용)
  decided_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE title_keep_verdicts ENABLE ROW LEVEL SECURITY;
