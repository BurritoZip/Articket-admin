import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type PipelineStep =
  | "crawl"
  | "sweep"
  | "fix"
  | "delete"
  | "enrich"
  | "merge"
  | "score";

export async function stepStart(step: PipelineStep) {
  const db = createServiceRoleClient();
  await db.from("pipeline_step_status").upsert({
    step_name: step,
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    result: null,
    error: null,
  });
}

export async function stepProgress(
  step: PipelineStep,
  result: Record<string, unknown>,
) {
  const db = createServiceRoleClient();
  await db
    .from("pipeline_step_status")
    .update({ result })
    .eq("step_name", step);
}

export async function stepDone(
  step: PipelineStep,
  result: Record<string, unknown>,
) {
  const db = createServiceRoleClient();
  await db
    .from("pipeline_step_status")
    .update({
      status: "done",
      finished_at: new Date().toISOString(),
      result,
      error: null,
    })
    .eq("step_name", step);
}

export async function stepFailed(step: PipelineStep, error: string) {
  const db = createServiceRoleClient();
  await db
    .from("pipeline_step_status")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error,
    })
    .eq("step_name", step);
}
