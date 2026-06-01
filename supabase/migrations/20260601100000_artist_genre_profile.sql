-- ============================================================
-- 아티스트 장르 프로필 VIEW — "당신이 좋아할만한 아티스트" 추천 신호
-- ============================================================
-- artists 테이블에는 genre 컬럼이 없다. 장르는 events.genre / timetable_performances.genre 에 있음.
-- 아티스트별 장르 분포를 집계해 장르 유사도 매칭 신호로 사용한다.
-- (Supabase JS에 GROUP BY 빌더가 없어 VIEW로 노출 — artist_engagement_agg 패턴과 동일)

CREATE OR REPLACE VIEW artist_genre_agg AS
SELECT
  artist_id,
  genre,
  COUNT(*) AS cnt   -- 해당 장르 출연 횟수 (= 장르 가중치)
FROM (
  -- 공연 자체 장르 (event_artists 경유)
  SELECT ea.artist_id, e.genre
  FROM event_artists ea
  JOIN events e ON e.id = ea.event_id
  WHERE e.genre IS NOT NULL AND e.genre <> ''
  UNION ALL
  -- 타임테이블 개별 무대 장르 (페스티벌 라인업)
  SELECT tp.artist_id, tp.genre
  FROM timetable_performances tp
  WHERE tp.artist_id IS NOT NULL AND tp.genre IS NOT NULL AND tp.genre <> ''
) g
GROUP BY artist_id, genre;
