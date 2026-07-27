-- StagePick 완전 제거: crawler_sources 행 삭제 (자동 크롤·소스관리 탭에서 제외)
DELETE FROM crawler_sources WHERE name = 'stagepick';
