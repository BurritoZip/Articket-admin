-- 운영자 수동 수정 잠금
--
-- 문제(감사 D S3): 운영자가 admin 에서 제목·포스터·날짜를 고쳐도, 다음 크롤 upsert 가
--   TRACKED_FIELDS 를 무조건 덮어써서 수정이 반복 소실됐다. updated_by_crawler 컬럼이
--   있으나 쓰기만 하고 읽지 않았다.
-- 조치: 운영자가 고친 필드명을 locked_fields 에 기록하고, upsert 는 잠긴 필드를 건드리지 않는다.
--   (크롤이 계속 갱신해야 하는 나머지 필드는 그대로 last-write 유지)

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS locked_fields TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN events.locked_fields IS
  '운영자가 수동 수정해 크롤 덮어쓰기에서 보호할 필드명 목록(예: title, poster_url). upsert 가 이 목록의 필드는 갱신하지 않는다.';
