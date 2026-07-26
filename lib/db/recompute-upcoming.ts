import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** 아티스트의 upcoming_event_count 재계산 (종료/취소 제외 이벤트 수). */
export async function recomputeUpcomingCount(artistId: string): Promise<void> {
  const db = createServiceRoleClient();
  const { count } = await db
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("artist_id", artistId)
    .not("status", "in", "(ended,cancelled)");
  await db
    .from("artists")
    .update({ upcoming_event_count: count ?? 0 })
    .eq("id", artistId);
}
