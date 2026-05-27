-- =====================================================
-- 크롤러 구조 변경 감지를 위한 step 타입 확장
-- ingestion_errors.step에 'structure_change' 추가
-- =====================================================

-- 기존 CHECK 제약 제거 후 재추가 (structure_change 포함)
ALTER TABLE ingestion_errors
  DROP CONSTRAINT IF EXISTS ingestion_errors_step_check;

ALTER TABLE ingestion_errors
  ADD CONSTRAINT ingestion_errors_step_check
    CHECK (step IN (
      'crawl', 'parse', 'normalize', 'match', 'upsert', 'ai',
      'structure_change'
    ));

COMMENT ON COLUMN ingestion_errors.step IS
  'crawl: 네트워크 오류, parse: HTML 파싱 실패, normalize: 정규화 오류,
   match: 아티스트/공연장 매칭 오류, upsert: DB 저장 오류, ai: AI 처리 오류,
   structure_change: CSS 선택자 변경으로 결과 0건 감지';
