import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import {
  runSingleStep,
  STEP_SEQUENCE,
} from "@/lib/pipeline/run-pipeline";
import type { PipelineStep } from "@/lib/db/pipeline-tracker";

export const maxDuration = 300;

// 단일 단계 재실행 — 운영자 triage 루프("고치고 이것만 다시").
export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { step } = (await request.json()) as { step?: string };
  if (!step || !STEP_SEQUENCE.includes(step as PipelineStep)) {
    return NextResponse.json(
      { error: "bad_step", detail: `유효한 단계 아님: ${step}` },
      { status: 400 },
    );
  }

  try {
    const result = await runSingleStep(step as PipelineStep, {
      trigger: "pipeline",
    });
    return NextResponse.json({ ok: true, step, result });
  } catch (e) {
    return NextResponse.json(
      { error: "step_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
