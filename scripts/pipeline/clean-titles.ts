/**
 * 1회성: 기존 events 제목에서 발표·예매 단계 꼬리표 제거.
 * "서울재즈페스티벌 2020 - 2차 라인업" → "서울재즈페스티벌 2020"
 * 로직은 cleanDisplayTitle() 공용 헬퍼 사용(파이프라인 fix 단계와 동일).
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/pipeline/clean-titles.ts          # dry-run
 *   npx tsx --env-file=.env.local scripts/pipeline/clean-titles.ts --apply  # 실제 UPDATE
 */
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import { cleanDisplayTitle } from "../../lib/ingestion/normalize";

async function main() {
  const apply = process.argv.includes("--apply");
  const db = createServiceRoleClient();

  // PostgREST max-rows=1000 → range 페이지네이션으로 전체 조회
  const all: { id: string; title: string }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("events")
      .select("id,title")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }

  const changes = all
    .map((e) => ({ id: e.id, from: e.title, to: cleanDisplayTitle(e.title) }))
    .filter((c) => c.to !== c.from);

  console.log(
    `대상 ${all.length}개 중 변경 ${changes.length}개${apply ? " (APPLY)" : " (dry-run)"}`,
  );
  for (const c of changes.slice(0, 50)) {
    console.log(`  ${c.from.slice(0, 50).padEnd(52)} → ${c.to.slice(0, 40)}`);
  }
  if (changes.length > 50) console.log(`  … 외 ${changes.length - 50}개`);

  if (!apply) {
    console.log("\n--apply 없으면 변경 안 함.");
    return;
  }

  let ok = 0;
  for (const c of changes) {
    const { error: uErr } = await db
      .from("events")
      .update({ title: c.to })
      .eq("id", c.id);
    if (uErr) console.error(`  ✗ ${c.id}: ${uErr.message}`);
    else ok++;
  }
  console.log(`\n완료: ${ok}/${changes.length} UPDATE 성공`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
