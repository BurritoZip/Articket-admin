/**
 * 처리 불가/stuck 큐 항목 정리
 * 실행: npx tsx scripts/pipeline/queue-reset.ts
 */
import { createServiceRoleClient } from "../../lib/supabase/service-role";

async function main() {
  const db = createServiceRoleClient();

  // 1. stuck processing → failed 리셋
  const { count: stuckCount } = await db
    .from("ai_processing_queue")
    .update({ status: "failed", error: "stuck in processing — reset" })
    .eq("status", "processing")
    .select("id");
  console.log(`stuck processing → failed: ${stuckCount ?? 0}개`);

  // 2. 처리 코드 없는 task_type → failed
  const unhandled = ["match_artist", "normalize_venue", "parse_dates"];
  for (const taskType of unhandled) {
    const { count } = await db
      .from("ai_processing_queue")
      .update({
        status: "failed",
        error: `no processor for task_type="${taskType}"`,
      })
      .eq("task_type", taskType)
      .eq("status", "pending")
      .select("id");
    console.log(`  ${taskType} pending → failed: ${count ?? 0}개`);
  }

  // 3. 최종 현황
  const { data } = await db
    .from("ai_processing_queue")
    .select("entity_type, task_type, status")
    .limit(5000);

  const groups = new Map<string, Map<string, number>>();
  for (const row of data ?? []) {
    const key = `${row.entity_type}/${row.task_type}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const m = groups.get(key)!;
    m.set(row.status, (m.get(row.status) ?? 0) + 1);
  }

  console.log("\n최종 큐 현황:");
  for (const [key, statusMap] of Array.from(groups.entries()).sort()) {
    const parts = Array.from(statusMap.entries())
      .map(([s, n]) => `${s}:${n}`)
      .join(", ");
    console.log(`  ${key.padEnd(35)} ${parts}`);
  }
}

main().catch(console.error);
