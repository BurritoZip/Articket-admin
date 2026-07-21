-- 소스 신뢰도 + 필드 provenance
--
-- 문제(감사 D): upsert 병합이 "신규값이 null 만 아니면 무조건 이긴다"(last-write-wins).
--   소스 신뢰도 개념이 없어, yes24 가 정확한 제목을 넣어도 다음 실행에서 stagepick 이 잘린
--   제목을 주면 덮어썼다. 어느 소스가 어느 필드를 언제 넣었는지도 추적 불가.
-- 조치:
--   1) crawler_sources.trust_score — 소스 신뢰도(높을수록 우선).
--   2) events.field_sources — 필드별 provenance {필드: {source, at}}.
--   upsert 는 "새 소스 신뢰도 >= 기존 필드 소스 신뢰도"일 때만 덮는다(기존 null 이면 항상 채움).

ALTER TABLE crawler_sources
  ADD COLUMN IF NOT EXISTS trust_score INTEGER NOT NULL DEFAULT 50;

COMMENT ON COLUMN crawler_sources.trust_score IS
  '소스 데이터 신뢰도(0~100). upsert 병합 우선순위 — 낮은 소스는 높은 소스 값을 덮지 못한다.';

-- 예매처 공식 데이터가 가장 정확. 페스티벌 aggregator 는 중간, LLM 발견은 낮음.
UPDATE crawler_sources SET trust_score = 70 WHERE name IN ('interpark', 'yes24', 'melon', 'yanolja');
UPDATE crawler_sources SET trust_score = 60 WHERE name = 'stagepick';
UPDATE crawler_sources SET trust_score = 55 WHERE name = 'festivallife';
UPDATE crawler_sources SET trust_score = 20 WHERE name = 'gemini-search';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS field_sources JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN events.field_sources IS
  '필드별 출처 {필드명: {source, at}}. upsert 병합이 소스 신뢰도 비교에 사용.';
