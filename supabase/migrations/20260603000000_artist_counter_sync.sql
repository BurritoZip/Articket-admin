-- ============================================================
-- [iOS 전달 / 2026-06-03] 아티스트 카운터 동기화 버그 수정
-- followers_count / upcoming_event_count 가 항상 0으로 표시되는 문제
-- ============================================================
--
-- 증상(iOS 앱):
--   - 팔로우 중인데 팔로워 수가 0 으로 표시
--   - 연결된 공연이 있는데 공연 수가 0 으로 표시
--   iOS 는 artists.followers_count / artists.upcoming_event_count 컬럼을 그대로
--   읽어 표시한다(계산 안 함). 즉 컬럼 미갱신이 원인이며 iOS 코드는 정상이다.
--
-- 원인 1) followers_count: 팔로우(user_artist_followings insert/delete) 시 컬럼을
--   증감하는 트리거/함수가 없음. Admin 목록 API 는 followMap 으로 즉석 COUNT 만
--   하고 컬럼에 저장하지 않음 → init.sql 의 DEFAULT 0 그대로 유지.
--
-- 원인 2) upcoming_event_count: 기존 recomputeUpcomingCount() 가 레거시 단일 컬럼
--   events.artist_id 기준으로 카운트하나, 실제 연결은 event_artists 조인 테이블을
--   사용(다중출연/페스티벌/크롤러 인입, iOS·Admin linked_event_count 모두 동일).
--   → event_artists 로만 연결된 공연이 카운트되지 않음. 갱신 시점도 Admin 이벤트
--   생성/수정에 한정됨.
--   (events.status CHECK = upcoming/on_sale/ongoing/ended. 'cancelled' 는 없음)
--
-- 적용 후: 아래 TS 레벨 recompute 는 불필요/정렬 필요 —
--   app/api/admin/events/route.ts, app/api/admin/events/[id]/route.ts,
--   lib/ingestion/artist-backfill.ts 의 recomputeUpcomingCount()
-- ============================================================

-- ── 1) followers_count: 팔로우/언팔로우 시 자동 증감 ──────────────────
CREATE OR REPLACE FUNCTION sync_artist_followers_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE artists SET followers_count = followers_count + 1
    WHERE id = NEW.artist_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE artists SET followers_count = GREATEST(followers_count - 1, 0)
    WHERE id = OLD.artist_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_artist_followers ON user_artist_followings;
CREATE TRIGGER trg_sync_artist_followers
AFTER INSERT OR DELETE ON user_artist_followings
FOR EACH ROW EXECUTE FUNCTION sync_artist_followers_count();

-- 기존 데이터 백필
UPDATE artists a SET followers_count = COALESCE(
  (SELECT COUNT(*) FROM user_artist_followings f WHERE f.artist_id = a.id), 0);


-- ── 2) upcoming_event_count: event_artists 조인 기준으로 재정의 ────────
-- 2a) 단일 아티스트 재계산 함수
CREATE OR REPLACE FUNCTION recompute_upcoming_event_count(p_artist_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE artists SET upcoming_event_count = COALESCE((
    SELECT COUNT(DISTINCT ea.event_id)
    FROM event_artists ea
    JOIN events e ON e.id = ea.event_id
    WHERE ea.artist_id = p_artist_id
      AND e.status <> 'ended'
  ), 0)
  WHERE id = p_artist_id;
END;
$$;

-- 2b) event_artists 링크 변경 트리거
CREATE OR REPLACE FUNCTION trg_event_artists_recount_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_upcoming_event_count(OLD.artist_id);
  ELSE
    PERFORM recompute_upcoming_event_count(NEW.artist_id);
    IF TG_OP = 'UPDATE' AND NEW.artist_id <> OLD.artist_id THEN
      PERFORM recompute_upcoming_event_count(OLD.artist_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_artists_recount ON event_artists;
CREATE TRIGGER trg_event_artists_recount
AFTER INSERT OR UPDATE OR DELETE ON event_artists
FOR EACH ROW EXECUTE FUNCTION trg_event_artists_recount_fn();

-- 2c) events.status 변경 시 연결된 아티스트 전체 재계산
CREATE OR REPLACE FUNCTION trg_events_status_recount_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM recompute_upcoming_event_count(ea.artist_id)
    FROM event_artists ea WHERE ea.event_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_status_recount ON events;
CREATE TRIGGER trg_events_status_recount
AFTER UPDATE OF status ON events
FOR EACH ROW EXECUTE FUNCTION trg_events_status_recount_fn();

-- 2d) 전체 백필
UPDATE artists a SET upcoming_event_count = COALESCE((
  SELECT COUNT(DISTINCT ea.event_id)
  FROM event_artists ea JOIN events e ON e.id = ea.event_id
  WHERE ea.artist_id = a.id AND e.status <> 'ended'
), 0);
