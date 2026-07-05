/**
 * 아티스트 연결 실패 이벤트 제거 — 운영자 정책: "아티스트 없는 공연은 받지 마라".
 *
 * 삭제 조건:
 *   1. artist_link_status='no_artist' (Gemini가 못 찾음)
 *   2. artist_id IS NULL AND enrich_attempted_at IS NOT NULL (enrich 시도 후도 연결 실패)
 *   3. artist_id IS NULL AND artist_link_status IS NULL AND crawled_at < 3일 전 (오래 됐는데 여전히 null)
 *
 * 보존:
 *   - multi_artist (페스티벌·다중출연): 단일 artist_id 없는 게 정상 → 유지
 *   - artist_id 있는 것: 연결됨 → 유지
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function purgeUnlinkedEvents(): Promise<{ deleted: number }> {
  const db = createServiceRoleClient();
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();

  // 1. no_artist status
  const { data: d1 } = await db
    .from("events")
    .delete()
    .eq("artist_link_status", "no_artist")
    .is("artist_id", null)
    .select("id");

  // 2. enrich 시도 후도 artist_id 없음 (multi_artist 제외)
  const { data: d2 } = await db
    .from("events")
    .delete()
    .is("artist_id", null)
    .not("enrich_attempted_at", "is", null)
    .or("artist_link_status.is.null,artist_link_status.eq.no_artist")
    .select("id");

  // 3. 3일 이상 됐는데 여전히 null status + no artist
  const { data: d3 } = await db
    .from("events")
    .delete()
    .is("artist_id", null)
    .is("artist_link_status", null)
    .lt("crawled_at", threeDaysAgo)
    .select("id");

  const deleted = (d1?.length ?? 0) + (d2?.length ?? 0) + (d3?.length ?? 0);
  return { deleted };
}
