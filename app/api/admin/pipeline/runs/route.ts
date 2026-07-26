import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/require-admin";

// 파이프라인 실행 이력 (pipeline_runs) — 직전 실행 보고 + 이력.
// pipeline_step_status(실시간, 직전 1건만) 와 달리 실행별로 append 된 걸 읽는다.
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 100);

  const supabase = createClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select(
      "id, trigger, status, started_at, finished_at, duration_ms, step_count, failed_steps, summary, error",
    )
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    if ((error as { code?: string }).code === "42P01") {
      return NextResponse.json({ runs: [] });
    }
    return NextResponse.json(
      { error: "list_failed", detail: error.message },
      { status: 400 },
    );
  }
  return NextResponse.json({ runs: data ?? [] });
}
