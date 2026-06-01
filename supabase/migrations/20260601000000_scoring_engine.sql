-- ============================================================
-- 인기/트렌드 스코어링 엔진 스키마 (Phase 1 — 내부 신호)
-- ============================================================

-- 1. artists 점수 컬럼
ALTER TABLE artists ADD COLUMN IF NOT EXISTS popularity_score NUMERIC(5,2);
ALTER TABLE artists ADD COLUMN IF NOT EXISTS trending_score   NUMERIC(6,2);
ALTER TABLE artists ADD COLUMN IF NOT EXISTS score_breakdown  JSONB;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS score_updated_at TIMESTAMPTZ;

-- 2. events 점수 컬럼
ALTER TABLE events ADD COLUMN IF NOT EXISTS popularity_score NUMERIC(5,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS trending_score   NUMERIC(6,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS score_breakdown  JSONB;
ALTER TABLE events ADD COLUMN IF NOT EXISTS score_updated_at TIMESTAMPTZ;

-- 3. 정렬용 인덱스 (DESC NULLS LAST = 랭킹 쿼리)
CREATE INDEX IF NOT EXISTS idx_artists_popularity_score
  ON artists (popularity_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_artists_trending_score
  ON artists (trending_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_events_popularity_score
  ON events (popularity_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_events_trending_score
  ON events (trending_score DESC NULLS LAST);

-- 4. 스냅샷 히스토리 (트렌드 계산용 시계열)
CREATE TABLE IF NOT EXISTS popularity_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      TEXT NOT NULL CHECK (entity_type IN ('artist','event')),
  entity_id        UUID NOT NULL,
  signals          JSONB NOT NULL DEFAULT '{}',  -- 원시 신호 스냅샷
  popularity_score NUMERIC(6,2),                 -- 스냅샷 시점 점수
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- entity별 시간 역순 스캔 (트렌드 윈도우 조회)
CREATE INDEX IF NOT EXISTS idx_pop_snapshots_entity_time
  ON popularity_snapshots (entity_type, entity_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_pop_snapshots_captured_at
  ON popularity_snapshots (captured_at DESC);

-- 5. 집계 VIEW — 배치 신호 수집용 (Supabase JS에 GROUP BY 빌더 없음)
CREATE OR REPLACE VIEW artist_engagement_agg AS
SELECT
  a.id                          AS artist_id,
  COALESCE(fg.cnt, 0)           AS follower_graph_count,
  COALESCE(bm.cnt, 0)           AS event_bookmark_total,
  COALESCE(rv.cnt, 0)           AS review_volume,
  COALESCE(rv.avg_star, 0)      AS review_avg
FROM artists a
LEFT JOIN (
  SELECT artist_id, COUNT(*) AS cnt
  FROM user_artist_followings GROUP BY artist_id
) fg ON fg.artist_id = a.id
LEFT JOIN (
  SELECT ea.artist_id, COUNT(uie.user_id) AS cnt
  FROM event_artists ea
  JOIN user_interested_events uie ON uie.event_id = ea.event_id
  GROUP BY ea.artist_id
) bm ON bm.artist_id = a.id
LEFT JOIN (
  SELECT ea.artist_id, COUNT(cr.id) AS cnt, AVG(cr.star_count) AS avg_star
  FROM event_artists ea
  JOIN concert_reviews cr ON cr.event_id = ea.event_id
  GROUP BY ea.artist_id
) rv ON rv.artist_id = a.id;

CREATE OR REPLACE VIEW event_engagement_agg AS
SELECT
  e.id                          AS event_id,
  COALESCE(i.cnt, 0)            AS interested_count,
  COALESCE(b.cnt, 0)            AS booking_count,
  COALESCE(r.cnt, 0)            AS review_count,
  COALESCE(r.avg_star, 0)       AS review_avg,
  COALESCE(la.artist_count, 0)  AS artist_count
FROM events e
LEFT JOIN (
  SELECT event_id, COUNT(*) AS cnt FROM user_interested_events GROUP BY event_id
) i ON i.event_id = e.id
LEFT JOIN (
  SELECT event_id, COUNT(*) AS cnt FROM user_bookings GROUP BY event_id
) b ON b.event_id = e.id
LEFT JOIN (
  SELECT event_id, COUNT(*) AS cnt, AVG(star_count) AS avg_star
  FROM concert_reviews GROUP BY event_id
) r ON r.event_id = e.id
LEFT JOIN (
  SELECT event_id, COUNT(*) AS artist_count FROM event_artists GROUP BY event_id
) la ON la.event_id = e.id;

-- 6. 점수 일괄 적용 RPC — NOT NULL 컬럼 우회 (제공된 키만 갱신, 나머지 COALESCE 유지)
CREATE OR REPLACE FUNCTION apply_artist_scores(updates JSONB)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE artists a SET
    popularity_score = COALESCE((u->>'popularity_score')::numeric,     a.popularity_score),
    trending_score   = COALESCE((u->>'trending_score')::numeric,       a.trending_score),
    score_breakdown  = COALESCE(u->'score_breakdown',                  a.score_breakdown),
    score_updated_at = COALESCE((u->>'score_updated_at')::timestamptz, a.score_updated_at)
  FROM jsonb_array_elements(updates) AS u
  WHERE a.id = (u->>'id')::uuid;
$$;

CREATE OR REPLACE FUNCTION apply_event_scores(updates JSONB)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE events e SET
    popularity_score = COALESCE((u->>'popularity_score')::numeric,     e.popularity_score),
    trending_score   = COALESCE((u->>'trending_score')::numeric,       e.trending_score),
    score_breakdown  = COALESCE(u->'score_breakdown',                  e.score_breakdown),
    score_updated_at = COALESCE((u->>'score_updated_at')::timestamptz, e.score_updated_at)
  FROM jsonb_array_elements(updates) AS u
  WHERE e.id = (u->>'id')::uuid;
$$;

-- 7. 파이프라인 스텝 시드
INSERT INTO pipeline_step_status (step_name) VALUES ('score')
ON CONFLICT (step_name) DO NOTHING;
