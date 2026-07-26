-- 1) 이벤트 아티스트/공연장 연결을 트랜잭션 안에서 교체.
--    기존엔 event_artists/event_venues 를 DELETE 후 INSERT 를 비트랜잭션으로 해서,
--    INSERT 실패 시 연결이 통째로 소실됐다(문제1 자식행 버그와 동일 계열).
--    NULL 배열 = 해당 종류 미변경.
CREATE OR REPLACE FUNCTION replace_event_links(
  p_event_id uuid,
  p_artist_ids uuid[],
  p_venue_ids uuid[]
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_artist_ids IS NOT NULL THEN
    DELETE FROM event_artists WHERE event_id = p_event_id;
    INSERT INTO event_artists (event_id, artist_id, artist_name, role, display_order)
    SELECT p_event_id, a.id, a.name, 'lineup', x.ord - 1
    FROM unnest(p_artist_ids) WITH ORDINALITY AS x(aid, ord)
    JOIN artists a ON a.id = x.aid;
  END IF;

  IF p_venue_ids IS NOT NULL THEN
    DELETE FROM event_venues WHERE event_id = p_event_id;
    INSERT INTO event_venues (event_id, venue_id, display_order)
    SELECT p_event_id, x.vid, x.ord - 1
    FROM unnest(p_venue_ids) WITH ORDINALITY AS x(vid, ord);
  END IF;
END;
$$;

-- 2) 벌크 상태 변경 + status 잠금(pin) 을 한 문장으로.
--    운영자가 상태를 강제하면 locked_fields 에 'status' 를 추가해 sweeper 가 되돌리지 않게 한다.
CREATE OR REPLACE FUNCTION bulk_set_event_status(
  p_ids uuid[],
  p_status text
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE events
  SET status = p_status,
      locked_fields = (
        SELECT array(SELECT DISTINCT unnest(coalesce(locked_fields, '{}') || ARRAY['status']))
      )
  WHERE id = ANY(p_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
