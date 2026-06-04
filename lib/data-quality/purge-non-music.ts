/**
 * 자기치유 — Gemini가 "음악인 아님(is_music_artist=false)"으로 검증한 아티스트에
 * 연결된 이벤트를 자동 제거한다.
 *
 * 제목 분류기(autoPurgeNonConcerts)가 놓친 비콘서트(화가 전시, 배우 행사 등)를
 * 아티스트 검증으로 2차로 잡는 자가교정 루프. 매 파이프라인 실행마다 돈다.
 *
 * 안전장치: artist_id(대표 아티스트)가 명시적으로 is_music_artist=false 인 경우만.
 * 다중출연(festival, multi_artist)은 artist_id 가 단일이 아니라 영향 없음.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function purgeNonMusicArtistEvents(): Promise<{
  artists: number;
  deleted: number;
}> {
  const db = createServiceRoleClient();

  // 비음악 판정 아티스트
  const { data: nonMusic } = await db
    .from("artists")
    .select("id")
    .eq("is_music_artist", false);
  const ids = (nonMusic ?? []).map((a) => a.id as string);
  if (!ids.length) return { artists: 0, deleted: 0 };

  let deleted = 0;
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    // 대표 아티스트가 비음악인 이벤트 삭제(cascade)
    const { data } = await db
      .from("events")
      .delete()
      .in("artist_id", slice)
      .select("id");
    deleted += data?.length ?? 0;
  }
  return { artists: ids.length, deleted };
}
