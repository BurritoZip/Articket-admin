import { createServiceRoleClient } from "../../lib/supabase/service-role";

async function main() {
  const db = createServiceRoleClient();

  // 1) 미연결(artist_id null) 이벤트의 status 분포 — ended는 보강 무의미
  const statusDist: Record<string, number> = {};
  let from = 0;
  for (;;) {
    const { data } = await db
      .from("events")
      .select("status")
      .is("artist_id", null)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const k = r.status ?? "(null)";
      statusDist[k] = (statusDist[k] ?? 0) + 1;
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  // 2) pipeline_step_status — enrich 단계 최근 실행
  const { data: steps } = await db
    .from("pipeline_step_status")
    .select("step,status,updated_at,detail,started_at,finished_at")
    .order("updated_at", { ascending: false })
    .limit(20);

  console.log("=== artist_id null 이벤트의 status 분포 ===");
  console.log(statusDist);
  console.log("\n=== pipeline_step_status (최근 20) ===");
  for (const s of steps ?? []) {
    console.log(
      `${s.step.padEnd(10)} ${String(s.status).padEnd(10)} updated=${s.updated_at}  ${JSON.stringify(s.detail ?? "")}`,
    );
  }
}
main().catch(console.error);
