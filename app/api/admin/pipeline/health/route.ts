import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { isStalled } from "@/lib/db/pipeline-tracker";

// 파이프라인 전체 건강 verdict — 홈 최상단 🟢/🟡/🔴 배지용.
// 여러 신호(직전 실행 결과 · stall · 예정 실행 유실 · 적체)를 하나로 축약.
//
// 스케줄: 로컬 cron 06:00/18:00 KST 하루 2회 (간격 12h).
//   런타임(~5분) + 노트북 취침 catch-up 여유를 감안:
//   마지막 실행 이후 gap > 15h = 유실(🔴), 13~15h = 임박(🟡).
const MISS_RED_H = 15;
const MISS_YELLOW_H = 13;

type Level = "green" | "yellow" | "red";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createClient();

  const [lastRunRes, stepsRes, queueRes, proposalRes, appErrRes] =
    await Promise.all([
      supabase
        .from("pipeline_runs")
        .select("status, started_at, finished_at, failed_steps")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("pipeline_step_status")
        .select("step_name, status, started_at"),
      supabase
        .from("ai_processing_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed"),
      supabase
        .from("artists")
        .select("id", { count: "exact", head: true })
        .not("name_proposal", "is", null),
      supabase
        .from("app_error_logs")
        .select("id", { count: "exact", head: true })
        .eq("is_resolved", false),
    ]);

  const lastRun = lastRunRes.data as {
    status: string;
    started_at: string;
    finished_at: string | null;
    failed_steps: string[];
  } | null;
  const steps = (stepsRes.data ?? []) as Array<{
    step_name: string;
    status: string;
    started_at: string | null;
  }>;
  const queueFailed = queueRes.count ?? 0;
  const proposals = proposalRes.count ?? 0;
  const appErrors = appErrRes.count ?? 0;

  const stalledSteps = steps.filter((s) => isStalled(s.status, s.started_at));
  const gapH = lastRun
    ? (Date.now() - new Date(lastRun.started_at).getTime()) / 3_600_000
    : Infinity;

  let level: Level = "green";
  let reason = "정상 — 최근 실행 성공, 적체 없음";

  // ── 🔴 ───────────────────────────────────────────────────────────────
  if (!lastRun) {
    level = "red";
    reason = "실행 이력 없음 — 파이프라인이 한 번도 안 돌았습니다";
  } else if (stalledSteps.length > 0) {
    level = "red";
    reason = `단계 멈춤(stall) — ${stalledSteps.map((s) => s.step_name).join(", ")} 15분+ 진행 중`;
  } else if (lastRun.status === "failed") {
    level = "red";
    reason = `직전 실행 실패 — ${new Date(lastRun.started_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`;
  } else if (gapH > MISS_RED_H) {
    level = "red";
    reason = `예정 배치 유실 — 마지막 실행 이후 ${Math.floor(gapH)}시간 경과 (06/18시 예정, 성공 시각 ${new Date(lastRun.started_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})`;
  }

  // ── 🟡 (🔴 아닐 때만) ─────────────────────────────────────────────────
  if (level === "green") {
    if (lastRun && lastRun.status === "partial") {
      level = "yellow";
      reason = `직전 실행 부분 실패 — ${lastRun.failed_steps.join(", ")} 단계`;
    } else if (gapH > MISS_YELLOW_H) {
      level = "yellow";
      reason = `다음 배치 임박/지연 — 마지막 실행 이후 ${Math.floor(gapH)}시간`;
    } else if (queueFailed + proposals + appErrors > 0) {
      level = "yellow";
      const bits: string[] = [];
      if (queueFailed) bits.push(`AI큐 실패 ${queueFailed}`);
      if (proposals) bits.push(`이름 제안 대기 ${proposals}`);
      if (appErrors) bits.push(`앱 에러 미해결 ${appErrors}`);
      reason = `조치 대기 — ${bits.join(" · ")}`;
    }
  }

  return NextResponse.json({
    level,
    reason,
    signals: {
      lastRunStatus: lastRun?.status ?? null,
      lastRunStartedAt: lastRun?.started_at ?? null,
      gapHours: Number.isFinite(gapH) ? Math.round(gapH * 10) / 10 : null,
      stalledSteps: stalledSteps.map((s) => s.step_name),
      queueFailed,
      proposals,
      appErrors,
    },
  });
}
