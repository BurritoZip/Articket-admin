-- events 페스티벌 라인업 수집 추적 컬럼
--
-- 배경: 페스티벌/다중출연 공연은 단일 artist_id 로 표현 불가라 지금까지 artist_link_status='multi_artist'
-- 마킹만 하고 개별 아티스트를 아무도 채우지 않았다. 이제 enrich 단계가 source_urls 재스크래핑 +
-- Google 검색 그라운딩으로 라인업 전체를 수집해 event_artists 에 lineup 으로 연결한다.
-- 이 컬럼들은 마지막 수집 시각/수집된 인원 수를 추적해 재수집 주기(라인업은 점진 공개)와 진척을 관리한다.

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS lineup_checked_at timestamptz,   -- 마지막 라인업 수집 시각
    ADD COLUMN IF NOT EXISTS lineup_count integer NOT NULL DEFAULT 0;  -- 수집된 라인업 아티스트 수
