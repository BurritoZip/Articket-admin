/**
 * 아티스트 연결 실패 이벤트 제거 — 운영자 정책: "Gemini 로도 아티스트가 안 붙는 공연은 받지 마라".
 *
 * enrich(enrichEventArtists)가 제목에서 아티스트를 못 뽑은 경우 artist_link_status='no_artist'.
 * 그런 이벤트를 삭제한다.
 *
 * 보존:
 *   - multi_artist (페스티벌·다중출연): 단일 artist_id 가 없는 게 정상 → 유지
 *   - enrich_attempted_at IS NULL (아직 시도 안 함): 다음 enrich 에서 시도 → 유지
 *   - artist_id 가 이미 있는 것: 연결됨 → 유지
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function purgeUnlinkedEvents(): Promise<{ deleted: number }> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("events")
    .delete()
    .eq("artist_link_status", "no_artist")
    .is("artist_id", null)
    .select("id");
  return { deleted: data?.length ?? 0 };
}
