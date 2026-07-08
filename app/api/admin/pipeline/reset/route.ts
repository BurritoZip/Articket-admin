import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { withErrorHandler } from "@/lib/api-handler";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// 좀비 상태 수동 정리 — 죽은 실행이 남긴 running 단계/크롤잡을 failed 로 끊어준다.
// 파이프라인이 '동결'로 보일 때 관리자가 눌러 상태를 정상화하고 재실행할 수 있게.
export const POST = withErrorHandler(async () => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const db = createServiceRoleClient();
  const now = new Date().toISOString();

  const { data: steps } = await db
    .from("pipeline_step_status")
    .update({
      status: "failed",
      finished_at: now,
      error: "관리자 수동 리셋 — 멈춘 실행 정리",
    })
    .eq("status", "running")
    .select("step_name");

  const { data: jobs } = await db
    .from("crawler_jobs")
    .update({ status: "failed", finished_at: now, error_count: 1 })
    .eq("status", "running")
    .select("id");

  return NextResponse.json({
    ok: true,
    stepsReset: steps?.length ?? 0,
    jobsReset: jobs?.length ?? 0,
  });
});
