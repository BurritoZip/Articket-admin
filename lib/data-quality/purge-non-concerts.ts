/**
 * 비-콘서트 자동 제거 — 가수 콘서트·음악 페스티벌만 남긴다.
 *
 * 파이프라인 delete 단계에서 매번 호출. 최근 생성된(=새로 크롤된) 이벤트만 분류해
 * 비용을 한정하고, 기존분은 한 번 청소되면 다시 보지 않는다.
 *
 * 일회성 백필이 필요하면 scripts/pipeline/purge-non-concerts.ts 사용.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { classifyTitlesKeep } from "./classify-keep";

export async function autoPurgeNonConcerts(opts?: {
  recentDays?: number;
  maxItems?: number;
}): Promise<{ checked: number; deleted: number }> {
  const recentDays = opts?.recentDays ?? 2;
  const maxItems = opts?.maxItems ?? 300;
  const db = createServiceRoleClient();
  const since = new Date(Date.now() - recentDays * 86_400_000).toISOString();

  const { data: events } = await db
    .from("events")
    .select("id,title")
    .gte("created_at", since)
    .limit(maxItems);

  if (!events?.length) return { checked: 0, deleted: 0 };

  const verdicts = await classifyTitlesKeep(events.map((e) => e.title));
  const dropIds = events
    .filter((_, i) => verdicts[i] === "drop")
    .map((e) => e.id);

  let deleted = 0;
  const CHUNK = 100;
  for (let i = 0; i < dropIds.length; i += CHUNK) {
    const { error } = await db
      .from("events")
      .delete()
      .in("id", dropIds.slice(i, i + CHUNK));
    if (!error) deleted += Math.min(CHUNK, dropIds.length - i);
  }

  return { checked: events.length, deleted };
}
