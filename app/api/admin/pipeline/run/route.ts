/**
 * 수동 전체 파이프라인 트리거 (Admin UI)
 *
 * 8단계 로직은 lib/pipeline/run-pipeline.ts 한 곳에만 있다(세 진입점 공유).
 * 서버리스 maxDuration=300s 안에서 끝나도록 enrich 큐 드레인은 180s 로 제한.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { withErrorHandler } from "@/lib/api-handler";
import { runFullPipeline } from "@/lib/pipeline/run-pipeline";

export const maxDuration = 300;

export const POST = withErrorHandler(async () => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const summary = await runFullPipeline({
    trigger: "pipeline",
    enrichBudgetMs: 180_000,
  });

  return NextResponse.json({ ok: true, summary });
});
