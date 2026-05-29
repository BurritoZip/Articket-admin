import { createServiceRoleClient } from "../../lib/supabase/service-role";

async function main() {
  const db = createServiceRoleClient();
  const { data } = await db.from("ai_processing_queue")
    .select("entity_type, task_type, status")
    .limit(5000);

  const groups: Map<string, Map<string, number>> = new Map();
  for (const row of data ?? []) {
    const key = `${row.entity_type}/${row.task_type}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const m = groups.get(key)!;
    m.set(row.status, (m.get(row.status) ?? 0) + 1);
  }

  console.log("AI 처리 큐 현황:");
  for (const [key, statusMap] of Array.from(groups.entries()).sort()) {
    const parts = Array.from(statusMap.entries()).map(([s, n]) => `${s}:${n}`).join(", ");
    console.log(`  ${key.padEnd(35)} ${parts}`);
  }
}
main().catch(console.error);
