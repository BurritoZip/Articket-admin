-- 아티스트 앨범/뮤비를 트랜잭션 안에서 교체하는 RPC.
-- admin 편집 저장이 예전엔 DELETE 후 INSERT 를 비트랜잭션으로 실행해서,
-- INSERT 실패 시 기존 자식행이 영구 소실됐다. plpgsql 함수는 단일 트랜잭션으로
-- 실행되므로 중간 실패 시 전부 롤백된다.
--
-- p_albums / p_videos:
--   NULL      → 해당 종류는 건드리지 않음 (부분 저장 유지)
--   '[]'      → 전부 비움
--   [{...}]   → 전량 교체
--
-- 대상 테이블은 artist_albums / artist_music_videos.
-- view_count·like_count 는 스키마상 TEXT.

CREATE OR REPLACE FUNCTION replace_artist_children(
  p_artist_id uuid,
  p_albums jsonb,
  p_videos jsonb
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_albums IS NOT NULL THEN
    DELETE FROM artist_albums WHERE artist_id = p_artist_id;
    INSERT INTO artist_albums (artist_id, title, cover_url, released_year)
    SELECT p_artist_id, x.title, x.cover_url, x.released_year
    FROM jsonb_to_recordset(p_albums)
      AS x(title text, cover_url text, released_year text);
  END IF;

  IF p_videos IS NOT NULL THEN
    DELETE FROM artist_music_videos WHERE artist_id = p_artist_id;
    INSERT INTO artist_music_videos
      (artist_id, title, thumbnail_url, view_count, like_count, uploaded_at)
    SELECT p_artist_id, x.title, x.thumbnail_url, x.view_count, x.like_count, x.uploaded_at
    FROM jsonb_to_recordset(p_videos)
      AS x(title text, thumbnail_url text, view_count text, like_count text, uploaded_at timestamptz);
  END IF;
END;
$$;
