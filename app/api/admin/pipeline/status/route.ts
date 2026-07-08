import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isStalled, STALE_MINUTES } from "@/lib/db/pipeline-tracker";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const db = createServiceRoleClient();
  const { data } = await db
    .from("pipeline_step_status")
    .select("step_name,status,started_at,finished_at,result,error")
    .order("step_name");

  const now = Date.now();
  const elapsedMin = (from: string | null): number | null =>
    from ? Math.floor((now - new Date(from).getTime()) / 60_000) : null;

  // running 이지만 오래된 단계는 stalled 로 표시 — 관리자가 '동결'을 인지할 수 있게.
  const steps = (data ?? []).map((s) => ({
    ...s,
    elapsed_min: elapsedMin(s.status === "running" ? s.started_at : null),
    stalled: isStalled(s.status, s.started_at),
  }));

  // 멈춘 크롤 잡(running 오래됨)도 노출 — crawl 단계가 왜 안 끝나는지 파악용.
  const { data: stuckJobs } = await db
    .from("crawler_jobs")
    .select("id,source_name,status,started_at")
    .eq("status", "running")
    .order("started_at", { ascending: true })
    .limit(20);
  const stalledJobs = (stuckJobs ?? [])
    .filter((j) => isStalled(j.status, j.started_at))
    .map((j) => ({ ...j, elapsed_min: elapsedMin(j.started_at) }));

  return NextResponse.json({
    steps,
    stalledJobs,
    staleMinutes: STALE_MINUTES,
    anyStalled: steps.some((s) => s.stalled) || stalledJobs.length > 0,
  });
}
