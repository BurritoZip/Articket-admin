/**
 * 비-콘서트 자동 제거 — 가수 콘서트·음악 페스티벌만 남긴다.
 *
 * 두 단계로 작동:
 *  1) 룰 기반(즉시) — genre 가 이미 비음악으로 태깅된 이벤트 하드삭제. Gemini 불필요.
 *  2) Gemini 분류 — genre 미정(null)인 활성 이벤트를 제목으로 판별해 DROP 삭제.
 *     recentDays 는 과거 체크 안 된 분까지 잡도록 길게(기본 30일) 설정.
 *
 * 일회성 백필이 필요하면 scripts/pipeline/purge-non-concerts.ts 사용.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { classifyTitlesKeep } from "./classify-keep";

// Articket 에서 제거 대상인 비음악 장르 — event-enrich.ts 의 GENRES 에서 이미 제거됐지만
// 과거 데이터 또는 외부 유입분이 이 값을 가질 수 있다.
const NON_MUSIC_GENRES = [
  "뮤지컬",
  "연극",
  "전시",
  "미술",
  "무용",
  "클래식",
  "오페라",
  "발레",
  "국악",
];

/**
 * 분류 보류(pending_classification) 이벤트 재판정.
 *
 * Gemini 429 등으로 크롤 시 분류를 못 해 숨긴 채 저장된 이벤트를, 상한 해제 후 다시 판정한다.
 *   keep    → 노출(is_hidden 해제)
 *   drop    → 비콘서트 확정, 계속 숨김(hidden_reason=non_concert). 하드삭제하지 않는다.
 *   unknown → 아직 판정 불가, 그대로 대기(다음 실행에서 재시도)
 */
async function reclassifyHeldEvents(
  db: ReturnType<typeof createServiceRoleClient>,
): Promise<{ restored: number; dropped: number; stillHeld: number }> {
  const { data: held } = await db
    .from("events")
    .select("id,title")
    .eq("hidden_reason", "pending_classification");
  if (!held?.length) return { restored: 0, dropped: 0, stillHeld: 0 };

  const verdicts = await classifyTitlesKeep(held.map((e) => e.title));
  const restoreIds: string[] = [];
  const dropIds: string[] = [];
  held.forEach((e, i) => {
    if (verdicts[i] === "keep") restoreIds.push(e.id);
    else if (verdicts[i] === "drop") dropIds.push(e.id);
    // unknown → 그대로 대기
  });

  const CHUNK = 100;
  for (let i = 0; i < restoreIds.length; i += CHUNK)
    await db
      .from("events")
      .update({ is_hidden: false, hidden_at: null, hidden_reason: null })
      .in("id", restoreIds.slice(i, i + CHUNK));
  for (let i = 0; i < dropIds.length; i += CHUNK)
    await db
      .from("events")
      .update({ hidden_reason: "non_concert" })
      .in("id", dropIds.slice(i, i + CHUNK));

  return {
    restored: restoreIds.length,
    dropped: dropIds.length,
    stillHeld: held.length - restoreIds.length - dropIds.length,
  };
}

export async function autoPurgeNonConcerts(opts?: {
  recentDays?: number;
  maxItems?: number;
}): Promise<{
  checked: number;
  deleted: number;
  restored: number;
  stillHeld: number;
}> {
  const recentDays = opts?.recentDays ?? 30;
  const maxItems = opts?.maxItems ?? 300;
  const db = createServiceRoleClient();
  let deleted = 0;
  const CHUNK = 100;

  // 분류 보류분 재판정 — keep 은 노출, drop 은 숨김 유지
  const held = await reclassifyHeldEvents(db);
  deleted += held.dropped; // drop 확정분(하드삭제는 아니지만 노출에서 빠짐)

  // ── 1) 룰 기반: 비음악 장르로 이미 태깅된 이벤트 즉시 삭제 ──────────────────
  const { data: genreTagged } = await db
    .from("events")
    .select("id")
    .in("genre", NON_MUSIC_GENRES);

  const genreDropIds = (genreTagged ?? []).map((e) => e.id);
  for (let i = 0; i < genreDropIds.length; i += CHUNK) {
    const { error } = await db
      .from("events")
      .delete()
      .in("id", genreDropIds.slice(i, i + CHUNK));
    if (!error) deleted += Math.min(CHUNK, genreDropIds.length - i);
  }

  // ── 2) Gemini 분류: genre 미정 OR 스크래퍼가 임의로 '콘서트' 부여한 미보강 이벤트 ──
  // 스크래퍼는 장르를 확인 없이 "콘서트"로 부여하므로, enrich 전 항목도 체크한다.
  const since = new Date(Date.now() - recentDays * 86_400_000).toISOString();
  const [{ data: nullGenre }, { data: unenrichedConcert }] = await Promise.all([
    db
      .from("events")
      .select("id,title")
      .is("genre", null)
      .not("status", "eq", "ended")
      .gte("created_at", since)
      .limit(maxItems),
    db
      .from("events")
      .select("id,title")
      .eq("genre", "콘서트")
      .is("enrich_attempted_at", null)
      .not("status", "eq", "ended")
      .gte("created_at", since)
      .limit(maxItems),
  ]);

  const seen = new Set<string>();
  const events = [...(nullGenre ?? []), ...(unenrichedConcert ?? [])].filter(
    (e) => !seen.has(e.id) && seen.add(e.id),
  );

  const checked = events.length + genreDropIds.length;
  if (!events.length)
    return {
      checked,
      deleted,
      restored: held.restored,
      stillHeld: held.stillHeld,
    };

  const verdicts = await classifyTitlesKeep(events.map((e) => e.title));
  const dropIds = events
    .filter((_, i) => verdicts[i] === "drop")
    .map((e) => e.id);

  for (let i = 0; i < dropIds.length; i += CHUNK) {
    const { error } = await db
      .from("events")
      .delete()
      .in("id", dropIds.slice(i, i + CHUNK));
    if (!error) deleted += Math.min(CHUNK, dropIds.length - i);
  }

  return {
    checked,
    deleted,
    restored: held.restored,
    stillHeld: held.stillHeld,
  };
}
