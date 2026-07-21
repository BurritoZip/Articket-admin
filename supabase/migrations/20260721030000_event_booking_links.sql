-- 예매처 선택지 (booking_links)
--
-- 문제: 같은 공연이 interpark·yes24·melon·yanolja 등 여러 예매처에서 동시에 팔려도,
--   events.booking_url 이 단일 컬럼이라 앱은 한 곳만 보여준다. dedup 이 여러 소스를 한 이벤트로
--   합칠 때 source_urls 에는 모든 예매처 URL 이 보존되지만, 앱은 그걸 예매 선택지로 쓰지 않는다.
--   → 실측 62건이 2곳 이상 예매처를 갖고도 선택지가 앱에서 안 보였다.
-- 조치: source_urls 에서 예매처 URL 만 정제해 [{provider, url}] 배열로 제공.
--   앱이 "어디서 예매?" 팝업으로 표시. 중복 제거가 아니라 선택지 보존.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS booking_links JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN events.booking_links IS
  '예매처 선택지 [{provider, url}]. source_urls 에서 예매처 링크만 정제. 앱 예매 팝업용.';
