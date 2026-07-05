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

export async function autoPurgeNonConcerts(opts?: {
  recentDays?: number;
  maxItems?: number;
}): Promise<{ checked: number; deleted: number }> {
  const recentDays = opts?.recentDays ?? 30;
  const maxItems = opts?.maxItems ?? 300;
  const db = createServiceRoleClient();
  let deleted = 0;
  const CHUNK = 100;

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
  if (!events.length) return { checked, deleted };

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

  return { checked, deleted };
}
