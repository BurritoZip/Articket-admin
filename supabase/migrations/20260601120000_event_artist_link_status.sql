-- ============================================================
-- 이벤트 아티스트 연결 상태 분류 + 보강 시도 마킹
-- ============================================================
-- 문제: enrichEventArtists 가 artist_id IS NULL 이벤트를 start_date desc 로 매번 같은
--       100개만 재선택 → 추출 실패(주로 페스티벌/투어, 제목에 단일 아티스트 없음)건이
--       큐 앞을 영구 점유, 백로그(918건)가 줄지 않음.
-- 해결: 보강 시도/결과를 마킹해 재선택을 방지하고, 페스티벌류는 'multi_artist'로 분류해
--       "진짜 빈칸"(개별 콘서트 미연결)과 구분한다.

-- 연결 상태:
--   NULL          = 아직 보강 시도 안 함
--   'linked'      = 단일 아티스트 연결됨
--   'multi_artist'= 페스티벌/다중 출연 — 단일 artist_id 없는 게 정상 (라인업으로 표현)
--   'no_artist'   = 개별 공연인데 아티스트 추출 불가 (진짜 미흡 — 후속 보강 대상)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS artist_link_status TEXT
    CHECK (artist_link_status IN ('linked', 'multi_artist', 'no_artist'));

-- 보강 시도 시각 — 재선택 방지(진도 보장)용 워터마크
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS enrich_attempted_at TIMESTAMPTZ;

-- 보강 대상 선택 쿼리 인덱스: artist_id IS NULL AND enrich_attempted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_events_enrich_pending
  ON events (enrich_attempted_at)
  WHERE artist_id IS NULL;
