import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { postSlack } from "@/lib/slack";

export type PipelineStep =
  | "crawl"
  | "sweep"
  | "fix"
  | "delete"
  | "enrich"
  | "merge"
  | "score"
  | "purge";

const STEP_LABEL: Record<PipelineStep, string> = {
  crawl: "크롤링",
  sweep: "상태 업데이트",
  fix: "품질 수정",
  delete: "불량 삭제",
  enrich: "보강",
  merge: "중복 병합",
  score: "점수 산출",
  purge: "종료 공연 정리",
};

/**
 * 단계 결과(중첩 객체/배열 포함)를 "key=value" 컴팩트 문자열로 평탄화.
 * 숫자 필드만 뽑되 0도 포함(무엇이 얼마 처리됐는지 명확히). 배열은 길이로.
 * 의미 있는 변경이 하나라도 있으면 hasChange=true.
 */
function flattenResult(result: Record<string, unknown>): {
  text: string;
  hasChange: boolean;
} {
  const parts: string[] = [];
  let hasChange = false;
  const walk = (obj: Record<string, unknown>, prefix = "") => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "number") {
        parts.push(`${prefix}${k}=${v}`);
        if (v > 0) hasChange = true;
      } else if (Array.isArray(v)) {
        parts.push(`${prefix}${k}=${v.length}`);
        if (v.length > 0) hasChange = true;
      } else if (v && typeof v === "object") {
        walk(v as Record<string, unknown>, `${k}.`);
      }
    }
  };
  walk(result);
  return { text: parts.join(" · ").slice(0, 800), hasChange };
}

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
  await db.from("pipeline_step_status").update({ result }).eq("step_name", step);
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

  // 변경이 있었던 단계만 Slack 알림(0-변경 단계는 소음이라 스킵). 실패해도 흐름 안 막음.
  const { text, hasChange } = flattenResult(result);
  if (hasChange) {
    await postSlack(`:gear: *[파이프라인] ${STEP_LABEL[step]} 완료*\n${text}`);
  }
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

  await postSlack(`:x: *[파이프라인] ${STEP_LABEL[step]} 실패*\n${error.slice(0, 500)}`);
}
