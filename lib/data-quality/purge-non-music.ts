/**
 * 자기치유 — Gemini가 "음악인 아님(is_music_artist=false)"으로 검증한 아티스트 정리.
 *
 * 주의: is_music=false 는 (a)화가/배우 같은 진짜 비음악인 + (b)제목에서 잘못 추출된
 * 정크 아티스트명(TV쇼·시리즈·공연장명: "미스트롯4","무명전설","먼데이프로젝트X숲세권")
 * 둘 다 포함한다. 이 둘 다 **사람/그룹이 아니므로** 아티스트로선 잘못된 레코드다.
 *
 * → 이벤트는 삭제하지 않는다(진짜 콘서트일 수 있음). 대신 잘못된 아티스트 링크만 해제하고
 *   다시 추출되도록 표시한 뒤 정크 아티스트 레코드를 삭제한다.
 *   진짜 비콘서트(전시 등)는 제목 분류기(autoPurgeNonConcerts)가 별도로 삭제한다.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function purgeNonMusicArtistEvents(): Promise<{
  artists: number;
  unlinked: number;
  artistsDeleted: number;
}> {
  const db = createServiceRoleClient();

  const { data: nonMusic } = await db
    .from("artists")
    .select("id")
    .eq("is_music_artist", false);
  const ids = (nonMusic ?? []).map((a) => a.id as string);
  if (!ids.length) return { artists: 0, unlinked: 0, artistsDeleted: 0 };

  let unlinked = 0;
  let artistsDeleted = 0;
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    // 1) 대표 아티스트 링크 해제 + 재추출 대상으로 표시(이벤트는 보존)
    const { data: unl } = await db
      .from("events")
      .update({ artist_id: null, artist_link_status: null, enrich_attempted_at: null })
      .in("artist_id", slice)
      .select("id");
    unlinked += unl?.length ?? 0;
    // 2) event_artists 조인의 정크 아티스트 행 제거
    await db.from("event_artists").delete().in("artist_id", slice);
    // 3) 정크 아티스트 레코드 삭제
    const { data: del } = await db
      .from("artists")
      .delete()
      .in("id", slice)
      .select("id");
    artistsDeleted += del?.length ?? 0;
  }
  return { artists: ids.length, unlinked, artistsDeleted };
}
