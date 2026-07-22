/**
 * 기존 소프트 병합 흡수 행 정리 — merged_into_event_id 로 숨겨둔 중복을 하드삭제.
 *
 * event-auto-merge 가 소프트 병합(is_hidden + merged_into)이던 시절 남은 흡수 행들을,
 * 새 방식(FK 재지정 후 하드삭제)에 맞춰 실제로 제거한다. 유저 데이터는 canonical 로 이관.
 * event_merge_logs 스냅샷은 이미 있으므로 복구 가능.
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/pipeline/cleanup-merged-events.ts        # 미리보기
 *   npx tsx --env-file=.env.local scripts/pipeline/cleanup-merged-events.ts --apply
 */
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import { reassignEventUserData } from "../../lib/ingestion/event-auto-merge";

const APPLY = process.argv.includes("--apply");

async function main() {
  const db = createServiceRoleClient();
  const { data: rows } = await db
    .from("events")
    .select("id,merged_into_event_id,title")
    .not("merged_into_event_id", "is", null);
  const targets = (rows ?? []) as {
    id: string;
    merged_into_event_id: string;
    title: string;
  }[];

  console.log(`소프트 병합 흡수 행: ${targets.length}건`);
  if (!APPLY) {
    console.log("미리보기. --apply 로 FK 재지정 후 하드삭제.");
    return;
  }

  let deleted = 0;
  for (const t of targets) {
    // canonical 이 아직 존재하는지 확인(없으면 흡수 행을 지우면 안 됨 — 노출 유일본)
    const { data: canon } = await db
      .from("events")
      .select("id")
      .eq("id", t.merged_into_event_id)
      .maybeSingle();
    if (!canon) {
      console.warn(`  canonical 없음, 스킵: ${t.title.slice(0, 40)}`);
      continue;
    }
    await reassignEventUserData(db, t.id, t.merged_into_event_id);
    const { error } = await db.from("events").delete().eq("id", t.id);
    if (!error) deleted++;
    else console.warn(`  삭제 실패 ${t.id}: ${error.message}`);
  }
  console.log(`\n하드삭제 완료: ${deleted}/${targets.length}`);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
