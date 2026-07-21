/**
 * 아티스트 연결 실패 이벤트 숨김 — 운영자 정책: "아티스트 없는 공연은 앱에 내보내지 마라".
 *
 * 하드삭제였으나 소프트 숨김으로 바꿨다. 이유:
 *   - 연결 실패 원인의 상당수가 "정말 아티스트가 없음"이 아니라 enrich 실패(429/네트워크)다.
 *     삭제하면 다음 크롤에서 같은 이벤트를 처음부터 다시 만들고 다시 실패한다 — 비용만 태운다.
 *   - events 삭제는 CASCADE 라 user_bookings·user_interested_events 등 유저 데이터가 함께 날아간다.
 *   - 되돌릴 수 없어 오탐을 사후에 알 방법이 없다.
 * 앱은 is_hidden=false 만 조회하므로(20260702000000_event_soft_hide.sql) 노출 결과는 같다.
 *
 * 숨김 조건:
 *   1. artist_link_status='no_artist' (Gemini가 못 찾음)
 *   2. artist_id IS NULL AND enrich_attempted_at IS NOT NULL (enrich 시도 후도 연결 실패)
 *   3. artist_id IS NULL AND artist_link_status IS NULL AND crawled_at < 3일 전 (오래 됐는데 여전히 null)
 *
 * 보존:
 *   - multi_artist (페스티벌·다중출연): 단일 artist_id 없는 게 정상 → 유지
 *   - artist_id 있는 것: 연결됨 → 유지. 이전에 숨겨졌더라도 자동 복구된다(아래 unhidden).
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const REASON = "unlinked_no_artist";

export async function purgeUnlinkedEvents(): Promise<{
  hidden: number;
  unhidden: number;
}> {
  const db = createServiceRoleClient();
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  const now = new Date().toISOString();
  const patch = { is_hidden: true, hidden_at: now, hidden_reason: REASON };

  // 1. no_artist status
  const { data: d1 } = await db
    .from("events")
    .update(patch)
    .eq("artist_link_status", "no_artist")
    .is("artist_id", null)
    .eq("is_hidden", false)
    .select("id");

  // 2. enrich 시도 후도 artist_id 없음 (multi_artist 제외)
  const { data: d2 } = await db
    .from("events")
    .update(patch)
    .is("artist_id", null)
    .not("enrich_attempted_at", "is", null)
    .or("artist_link_status.is.null,artist_link_status.eq.no_artist")
    .eq("is_hidden", false)
    .select("id");

  // 3. 3일 이상 됐는데 여전히 null status + no artist
  const { data: d3 } = await db
    .from("events")
    .update(patch)
    .is("artist_id", null)
    .is("artist_link_status", null)
    .lt("crawled_at", threeDaysAgo)
    .eq("is_hidden", false)
    .select("id");

  // 자가치유: 나중에 아티스트가 연결됐으면 숨김 해제.
  // 이 사유로 숨긴 건만 건드린다(180일 purge·병합 숨김은 그대로 둔다).
  const { data: back } = await db
    .from("events")
    .update({ is_hidden: false, hidden_at: null, hidden_reason: null })
    .eq("hidden_reason", REASON)
    .not("artist_id", "is", null)
    .select("id");

  return {
    hidden: (d1?.length ?? 0) + (d2?.length ?? 0) + (d3?.length ?? 0),
    unhidden: back?.length ?? 0,
  };
}
