import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** ended 후 이만큼 지난 공연을 앱에서 숨긴다 (하드삭제 아님). */
export const PURGE_ENDED_AFTER_DAYS = 180;

export interface PurgeOldEventsResult {
  hidden: number;
  thresholdDays: number;
  cutoff: string;
}

/**
 * 옛날 공연 소프트 숨김 — status='ended' 이고 end_date 가 임계일수(기본 180일) 지난 공연을
 * is_hidden=true 로 마킹한다. 하드삭제가 아니라 앱 노출만 차단(이력 보존, 되돌림 가능).
 *
 * end_date 가 null 이면 start_date 로 판정(sweep 과 동일 규칙).
 */
export async function purgeOldEvents(
  thresholdDays = PURGE_ENDED_AFTER_DAYS,
): Promise<PurgeOldEventsResult> {
  const db = createServiceRoleClient();
  const cutoff = new Date(
    Date.now() - thresholdDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const now = new Date().toISOString();
  const reason = `ended_${thresholdDays}d`;

  const { data, error } = await db
    .from("events")
    .update({ is_hidden: true, hidden_at: now, hidden_reason: reason })
    .eq("status", "ended")
    .eq("is_hidden", false)
    .or(`end_date.lt.${cutoff},and(end_date.is.null,start_date.lt.${cutoff})`)
    .select("id");

  // 에러를 삼키지 않는다 — 컬럼 미적용 등으로 실패하면 스텝이 done(0건)으로 위장되지 않게.
  if (error) throw new Error(`purgeOldEvents 실패: ${error.message}`);

  return { hidden: data?.length ?? 0, thresholdDays, cutoff };
}
