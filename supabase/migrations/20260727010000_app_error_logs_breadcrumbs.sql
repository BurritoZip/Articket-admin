-- iOS 진단 로깅: app_error_logs에 화면/직전 흔적(trail) 컬럼 추가.
-- iOS가 에러 리포트에 screen(발생 화면 VC명) + breadcrumbs(직전 화면/UI/API 흔적)를 채워 보낸다.
-- 추가 컬럼이라 기존 데이터/쿼리 무영향. 멱등(IF NOT EXISTS).
ALTER TABLE app_error_logs ADD COLUMN IF NOT EXISTS screen text;
ALTER TABLE app_error_logs ADD COLUMN IF NOT EXISTS breadcrumbs jsonb;
COMMENT ON COLUMN app_error_logs.screen IS '에러 발생 화면(뷰컨트롤러명)';
COMMENT ON COLUMN app_error_logs.breadcrumbs IS '직전 흔적 trail [{time,kind,screen,message,meta}]';
