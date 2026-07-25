"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatKst } from "@/lib/format-kst";
import {
  STEP_LABELS,
  STEP_ORDER,
  stepResultLines,
} from "@/lib/pipeline/step-display";

/** 실패 단계 → 관련 에러를 볼 페이지 (시각창 필터는 후속) */
function errorHref(step: string): string {
  return step === "crawl" ? "/admin/crawler" : "/admin/ingestion";
}

interface Run {
  id: string;
  trigger: string;
  status: "running" | "done" | "partial" | "failed";
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  step_count: number | null;
  failed_steps: string[];
  summary: Record<string, Record<string, unknown>> | null;
  error: string | null;
}

const STATUS_META: Record<
  Run["status"],
  { label: string; variant: "default" | "secondary" | "warning" | "danger" }
> = {
  done: { label: "완료", variant: "default" },
  partial: { label: "부분 실패", variant: "warning" },
  failed: { label: "실패", variant: "danger" },
  running: { label: "실행 중", variant: "secondary" },
};

function dur(ms: number | null): string {
  if (!ms) return "-";
  return ms < 60_000
    ? `${Math.round(ms / 1000)}초`
    : `${Math.round(ms / 60_000)}분`;
}

/** 직전 실행 보고 — 단계별 델타 + 실패 단계 강조(사유·재실행·드릴다운) */
function ReportBody({
  run,
  onRerun,
  rerunning,
}: {
  run: Run;
  onRerun: (step: string) => void;
  rerunning: string | null;
}) {
  const summary = run.summary ?? {};
  return (
    <div className="space-y-2">
      {run.error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-xs p-2">
          치명 오류: {run.error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {STEP_ORDER.filter((k) => k in summary).map((k) => {
          const failed = run.failed_steps.includes(k);
          const lines = stepResultLines(k, summary[k]);
          const errMsg = (summary[k] as { error?: string } | undefined)?.error;
          return (
            <div key={k} className="min-w-0">
              <div
                className={`text-xs font-medium ${failed ? "text-destructive" : ""}`}
              >
                {STEP_LABELS[k] ?? k}
                {failed && " ✕"}
              </div>
              {failed ? (
                <>
                  <div className="text-[11px] text-destructive/90 line-clamp-2">
                    {errMsg ?? "실패"}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      disabled={rerunning === k}
                      onClick={() => onRerun(k)}
                    >
                      {rerunning === k ? "재실행 중…" : "재실행"}
                    </Button>
                    <Link
                      href={errorHref(k)}
                      className="text-[11px] text-muted-foreground underline hover:text-foreground"
                    >
                      에러 보기
                    </Link>
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-muted-foreground truncate">
                  {lines.length ? lines.join(" · ") : "변경 없음"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PipelineRunsCard() {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["pipeline-runs"],
    queryFn: async () => {
      const res = await fetch("/api/admin/pipeline/runs?limit=30");
      if (!res.ok) throw new Error("runs fetch failed");
      return res.json() as Promise<{ runs: Run[] }>;
    },
    staleTime: 10_000,
    refetchInterval: 10_000, // 실행 끝나면 보고 카드가 스스로 갱신
  });

  const {
    mutate: rerun,
    variables: rerunStep,
    isPending: rerunPending,
  } = useMutation({
    mutationFn: async (step: string) => {
      const res = await fetch("/api/admin/pipeline/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step }),
      });
      const json = (await res.json()) as { detail?: string };
      if (!res.ok) throw new Error(json.detail ?? "재실행 실패");
      return json;
    },
    onSuccess: (_, step) => {
      toast.success(`${STEP_LABELS[step] ?? step} 재실행 완료`);
      void qc.invalidateQueries({ queryKey: ["pipeline-runs"] });
      void qc.invalidateQueries({ queryKey: ["pipeline-status"] });
      void qc.invalidateQueries({ queryKey: ["pipeline-health"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const rerunning = rerunPending ? (rerunStep ?? null) : null;

  const runs = data?.runs ?? [];
  const latest = runs[0];
  const history = runs.slice(1);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">파이프라인 실행 보고</CardTitle>
        {latest && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={STATUS_META[latest.status].variant}>
              {STATUS_META[latest.status].label}
            </Badge>
            <span>
              {latest.finished_at
                ? formatKst(latest.finished_at)
                : formatKst(latest.started_at)}{" "}
              · {dur(latest.duration_ms)} · {latest.trigger}
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!latest && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            실행 이력이 없습니다.
          </p>
        )}
        {latest && (
          <ReportBody run={latest} onRerun={rerun} rerunning={rerunning} />
        )}

        {history.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              이전 실행 {history.length}건
            </p>
            <div className="space-y-1">
              {history.map((run) => (
                <div key={run.id} className="text-xs">
                  <button
                    className="flex w-full items-center gap-2 py-1 text-left hover:bg-muted/50 rounded px-1"
                    onClick={() =>
                      setExpanded(expanded === run.id ? null : run.id)
                    }
                  >
                    <Badge
                      variant={STATUS_META[run.status].variant}
                      className="h-4 px-1 text-[10px]"
                    >
                      {STATUS_META[run.status].label}
                    </Badge>
                    <span className="text-muted-foreground">
                      {formatKst(run.started_at)}
                    </span>
                    <span className="text-muted-foreground">
                      · {dur(run.duration_ms)}
                    </span>
                    {run.failed_steps.length > 0 && (
                      <span className="text-destructive">
                        · 실패 {run.failed_steps.join(", ")}
                      </span>
                    )}
                  </button>
                  {expanded === run.id && (
                    <div className="pl-2 pb-2 pt-1">
                      <ReportBody
                        run={run}
                        onRerun={rerun}
                        rerunning={rerunning}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
