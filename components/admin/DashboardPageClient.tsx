"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  Loader2,
  MapPin,
  Minus,
  Music,
  Play,
  RefreshCw,
  Sparkles,
  Ticket,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatKst } from "@/lib/format-kst";

// ── 타입 ─────────────────────────────────────────────────────────────

interface DashboardStats {
  events: {
    total: number;
    upcoming: number;
    on_sale: number;
    ongoing: number;
    ended: number;
    needs_end_update: number;
  };
  artists: { total: number };
  venues: { total: number };
  users: { total: number };
  ticket_opens_soon: Array<{
    id: string;
    title: string;
    ticket_open_date: string;
    d_day: number;
  }>;
  unlinked_events: number;
  enrichment: {
    enriched: number;
    pending: number;
    skipped: number;
    failed: number;
  };
  queue: { pending: number; processing: number; done: number; failed: number };
  recent_jobs: Array<{
    id: string;
    source: string;
    status: string;
    finishedAt: string | null;
    eventsFound: number;
    eventsUpserted: number;
  }>;
  quality_fixes_7d: { nulled: number; queued: number; deleted: number };
}

type StepStatus = "idle" | "running" | "done" | "failed";

interface PipelineStep {
  step_name: string;
  status: StepStatus;
  started_at: string | null;
  finished_at: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

// ── 파이프라인 단계 메타 ───────────────────────────────────────────────

const STEPS = [
  {
    key: "crawl",
    label: "크롤링",
    icon: Database,
    desc: "yes24/melon/interpark",
  },
  {
    key: "sweep",
    label: "상태 업데이트",
    icon: RefreshCw,
    desc: "종료/진행 자동 전환",
  },
  { key: "fix", label: "품질 수정", icon: Zap, desc: "이상 필드 null 처리" },
  {
    key: "delete",
    label: "불량 삭제",
    icon: AlertTriangle,
    desc: "Gemini 판단 삭제",
  },
  {
    key: "enrich",
    label: "보강",
    icon: Sparkles,
    desc: "아티스트·공연 정보 채우기",
  },
  {
    key: "merge",
    label: "중복 병합",
    icon: CheckCircle2,
    desc: "완전일치 자동 병합",
  },
] as const;

// ── 헬퍼 ──────────────────────────────────────────────────────────────

function stepResultLines(s: PipelineStep): string[] {
  const r = s.result;
  if (!r) return [];
  if (s.step_name === "crawl") {
    const sources = Object.entries(r) as Array<
      [string, Record<string, unknown>]
    >;
    if (sources.length === 0) return ["활성 소스 없음"];
    return sources.map(([src, d]) =>
      d.error
        ? `${src}: 오류`
        : `${src}: 발견 ${d.eventsFound ?? 0} · 저장 ${d.eventsUpserted ?? 0}`,
    );
  }
  if (s.step_name === "sweep") {
    const lines = [`업데이트 ${r.updated ?? 0}건`];
    const bd = r.breakdown as Record<string, number> | undefined;
    if (bd) {
      const parts = Object.entries(bd)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k} ${v}`);
      if (parts.length) lines.push(parts.join(" · "));
    }
    return lines;
  }
  if (s.step_name === "fix") {
    const lines = [`필드수정 ${r.fixed ?? 0}건`];
    if ((r.queued as number) > 0) lines.push(`AI큐 등록 ${r.queued}건`);
    if ((r.flagged as number) > 0) lines.push(`이슈감지 ${r.flagged}건`);
    return lines;
  }
  if (s.step_name === "delete") return [`삭제 ${r.deleted ?? 0}건`];
  if (s.step_name === "enrich") {
    const total = r.total_in_queue as number | undefined;
    const processed = (r.processed as number) ?? 0;
    const succeeded = (r.succeeded as number) ?? 0;
    const failed = (r.failed as number) ?? 0;
    const lines = total
      ? [`${processed} / ${total}건 처리`]
      : [`처리 ${processed}건`];
    lines.push(`성공 ${succeeded}  실패 ${failed}`);
    return lines;
  }
  if (s.step_name === "merge")
    return [`아티스트 ${r.artists ?? 0}건`, `공연장 ${r.venues ?? 0}건`];
  return [];
}

function elapsed(s: PipelineStep, now?: number): string {
  if (!s.started_at) return "";
  const end = s.finished_at
    ? new Date(s.finished_at).getTime()
    : (now ?? Date.now());
  const ms = end - new Date(s.started_at).getTime();
  return ms < 60_000
    ? `${Math.round(ms / 1000)}s`
    : `${Math.round(ms / 60_000)}m`;
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────

export function DashboardPageClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [fixingEnded, setFixingEnded] = React.useState(false);
  const [runningPipeline, setRunningPipeline] = React.useState(false);
  const [selectedStep, setSelectedStep] = React.useState<PipelineStep | null>(
    null,
  );
  const [now, setNow] = React.useState(Date.now());

  // 실행 중일 때 경과시간 갱신
  React.useEffect(() => {
    if (!runningPipeline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [runningPipeline]);

  // stats
  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ["admin-dashboard-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dashboard/stats");
      if (!res.ok) throw new Error("stats fetch failed");
      return res.json() as Promise<DashboardStats>;
    },
    staleTime: 30_000,
  });

  // 파이프라인 상태 폴링
  const { data: pipelineData, refetch: refetchPipeline } = useQuery<{
    steps: PipelineStep[];
  }>({
    queryKey: ["pipeline-status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/pipeline/status");
      if (!res.ok) throw new Error("pipeline status fetch failed");
      return res.json() as Promise<{ steps: PipelineStep[] }>;
    },
    refetchInterval: runningPipeline ? 1500 : false,
    staleTime: 0,
  });

  const steps = pipelineData?.steps ?? [];
  const isAnyRunning = steps.some((s) => s.status === "running");

  // 실행 중 감지 → runningPipeline 동기화
  React.useEffect(() => {
    if (isAnyRunning && !runningPipeline) setRunningPipeline(true);
    if (!isAnyRunning && runningPipeline) {
      setRunningPipeline(false);
      void queryClient.invalidateQueries({
        queryKey: ["admin-dashboard-stats"],
      });
    }
  }, [isAnyRunning, runningPipeline, queryClient]);

  const handleRunPipeline = async () => {
    setRunningPipeline(true);
    void refetchPipeline();
    try {
      const res = await fetch("/api/admin/pipeline/run", { method: "POST" });
      if (!res.ok) throw new Error("파이프라인 실행 실패");
      toast.success("파이프라인 완료");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "실패");
    } finally {
      setRunningPipeline(false);
      void refetchPipeline();
      void queryClient.invalidateQueries({
        queryKey: ["admin-dashboard-stats"],
      });
    }
  };

  const handleFixEnded = async () => {
    setFixingEnded(true);
    try {
      const res = await fetch("/api/admin/events/sweep-statuses", {
        method: "POST",
      });
      const json = (await res.json()) as { updated?: number };
      toast.success(`${json.updated ?? 0}건 상태 업데이트`);
      void queryClient.invalidateQueries({
        queryKey: ["admin-dashboard-stats"],
      });
    } catch {
      toast.error("실패");
    } finally {
      setFixingEnded(false);
    }
  };

  const enrichTotal = data
    ? data.enrichment.enriched +
      data.enrichment.pending +
      data.enrichment.skipped +
      data.enrichment.failed
    : 1;
  const enrichPct = data
    ? Math.round((data.enrichment.enriched / enrichTotal) * 100)
    : 0;

  const kpiCards = [
    {
      label: "공연",
      icon: CalendarDays,
      total: data?.events.total,
      sub: data
        ? `예정 ${data.events.upcoming} · 예매중 ${data.events.on_sale} · 종료 ${data.events.ended}`
        : undefined,
      href: "/admin/events",
    },
    {
      label: "아티스트",
      icon: Music,
      total: data?.artists.total,
      sub: data
        ? `보강완료 ${data.enrichment.enriched} · 미보강 ${data.enrichment.pending}`
        : undefined,
      href: "/admin/artists",
    },
    {
      label: "공연장",
      icon: MapPin,
      total: data?.venues.total,
      href: "/admin/venues",
    },
    {
      label: "유저",
      icon: Users,
      total: data?.users.total,
      href: "/admin/users",
    },
  ];

  const hasActionItems =
    data &&
    (data.events.needs_end_update > 0 ||
      data.unlinked_events > 0 ||
      data.ticket_opens_soon.length > 0);

  return (
    <div className="space-y-6">
      {/* KPI 카드 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((card) => (
          <Card
            key={card.label}
            className="cursor-pointer transition-colors hover:border-brand/60"
            onClick={() => router.push(card.href)}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-body-sm font-medium text-text-secondary">
                {card.label}
              </CardTitle>
              <card.icon className="h-4 w-4 text-text-tertiary" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <p className="text-3xl font-bold">{card.total ?? 0}</p>
                  {card.sub && (
                    <p className="mt-1 text-body-sm text-text-tertiary">
                      {card.sub}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 파이프라인 실시간 시각화 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">데이터 파이프라인</CardTitle>
          <Button
            size="sm"
            onClick={() => void handleRunPipeline()}
            disabled={runningPipeline}
          >
            {runningPipeline ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            {runningPipeline ? "실행 중..." : "지금 실행"}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-0 overflow-x-auto pb-2">
            {STEPS.map((meta, i) => {
              const step = steps.find((s) => s.step_name === meta.key);
              const status: StepStatus = step?.status ?? "idle";
              return (
                <React.Fragment key={meta.key}>
                  <div
                    className={`flex min-w-[108px] flex-col items-center gap-1.5 px-1 ${
                      step && status !== "idle" ? "cursor-pointer" : ""
                    } ${selectedStep?.step_name === meta.key ? "opacity-100" : ""}`}
                    onClick={() => {
                      if (step && status !== "idle") {
                        setSelectedStep(
                          selectedStep?.step_name === meta.key ? null : step,
                        );
                      }
                    }}
                  >
                    {/* 아이콘 + 상태 링 */}
                    <div
                      className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all ${
                        status === "running"
                          ? "border-brand bg-brand/10 animate-pulse"
                          : status === "done"
                            ? "border-green-500 bg-green-50"
                            : status === "failed"
                              ? "border-red-500 bg-red-50"
                              : "border-border bg-surface-secondary"
                      } ${selectedStep?.step_name === meta.key ? "ring-2 ring-brand/40" : ""}`}
                    >
                      {status === "running" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-brand" />
                      ) : status === "done" ? (
                        <meta.icon className="h-4 w-4 text-green-600" />
                      ) : status === "failed" ? (
                        <XCircle className="h-4 w-4 text-red-500" />
                      ) : (
                        <meta.icon className="h-4 w-4 text-text-tertiary" />
                      )}
                    </div>

                    {/* 레이블 */}
                    <span className="text-center text-body-xs font-medium leading-tight">
                      {meta.label}
                    </span>

                    {/* 상태 + 경과시간 */}
                    <span
                      className={`text-body-xs font-semibold ${
                        status === "running"
                          ? "text-brand"
                          : status === "done"
                            ? "text-green-600"
                            : status === "failed"
                              ? "text-red-500"
                              : "text-text-tertiary"
                      }`}
                    >
                      {status === "idle" ? (
                        <Minus className="inline h-3 w-3" />
                      ) : status === "running" ? (
                        `실행 중 ${elapsed(step!, now)}`
                      ) : status === "done" ? (
                        `완료 ${elapsed(step!)}`
                      ) : (
                        "실패"
                      )}
                    </span>

                    {/* 결과 — 실행 중·완료 모두 표시 */}
                    {step &&
                      (status === "done" || status === "running") &&
                      stepResultLines(step).map((line, li) => (
                        <span
                          key={li}
                          className={`text-center text-body-xs leading-tight ${
                            status === "running"
                              ? "text-brand/80 font-medium"
                              : "text-text-tertiary"
                          }`}
                        >
                          {line}
                        </span>
                      ))}

                    {/* 에러 */}
                    {step?.error && (
                      <span
                        className="max-w-[108px] truncate text-center text-body-xs text-red-500 font-medium"
                        title={step.error}
                      >
                        ⚠ {step.error.slice(0, 40)}
                      </span>
                    )}
                  </div>

                  {/* 연결선 */}
                  {i < STEPS.length - 1 && (
                    <div
                      className={`mt-5 h-0.5 flex-1 min-w-[12px] transition-colors ${
                        steps.find((s) => s.step_name === STEPS[i + 1].key)
                          ?.status === "done" ||
                        steps.find((s) => s.step_name === STEPS[i + 1].key)
                          ?.status === "running"
                          ? "bg-brand/40"
                          : "bg-border"
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* 마지막 실행 시각 */}
          {steps.length > 0 &&
            steps.some((s) => s.finished_at) &&
            !isAnyRunning && (
              <p className="mt-3 border-t border-border pt-3 text-body-xs text-text-tertiary">
                마지막 실행:{" "}
                {formatKst(
                  steps
                    .filter((s) => s.finished_at)
                    .sort(
                      (a, b) =>
                        new Date(b.finished_at!).getTime() -
                        new Date(a.finished_at!).getTime(),
                    )[0]?.finished_at ?? "",
                )}
                {" · "}
                <span className="text-text-tertiary">
                  단계 클릭 시 상세 결과
                </span>
              </p>
            )}

          {/* 선택된 단계 상세 */}
          {selectedStep && (
            <div className="mt-3 rounded-md border border-border bg-surface-secondary p-3 text-body-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">
                  {STEPS.find((s) => s.key === selectedStep.step_name)?.label ??
                    selectedStep.step_name}{" "}
                  상세
                </span>
                <button
                  className="text-text-tertiary hover:text-text-primary"
                  onClick={() => setSelectedStep(null)}
                >
                  ✕
                </button>
              </div>

              {selectedStep.error && (
                <div className="mb-2 rounded bg-red-50 p-2 text-body-xs text-red-600">
                  <span className="font-semibold">오류:</span>{" "}
                  {selectedStep.error}
                </div>
              )}

              {selectedStep.started_at && (
                <div className="mb-1 text-body-xs text-text-tertiary">
                  시작: {formatKst(selectedStep.started_at)}
                  {selectedStep.finished_at && (
                    <>
                      {" "}
                      · 완료: {formatKst(selectedStep.finished_at)} ·{" "}
                      {elapsed(selectedStep)}
                    </>
                  )}
                </div>
              )}

              {selectedStep.result && (
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface-primary p-2 text-body-xs text-text-secondary">
                  {JSON.stringify(selectedStep.result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI 큐 + 보강 현황 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-brand" />
              AI 처리 큐
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : data ? (
              <>
                {[
                  {
                    label: "대기 중",
                    val: data.queue.pending,
                    color: data.queue.pending > 0 ? "text-yellow-500" : "",
                  },
                  { label: "처리 중", val: data.queue.processing, color: "" },
                  {
                    label: "완료",
                    val: data.queue.done,
                    color: "text-green-600",
                  },
                  {
                    label: "실패",
                    val: data.queue.failed,
                    color: data.queue.failed > 0 ? "text-red-500" : "",
                  },
                ].map(({ label, val, color }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between text-body-sm"
                  >
                    <span className="text-text-secondary">{label}</span>
                    <span className={`font-semibold ${color}`}>{val}건</span>
                  </div>
                ))}
                {data.queue.pending > 0 && (
                  <Button
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => router.push("/admin/ingestion")}
                  >
                    큐 전체 처리하기
                  </Button>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Music className="h-4 w-4 text-brand" />
              아티스트 보강 현황
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : data ? (
              <>
                <div className="space-y-1">
                  <div className="flex justify-between text-body-xs text-text-secondary">
                    <span>보강 완료</span>
                    <span>{enrichPct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-secondary">
                    <div
                      className="h-full rounded-full bg-brand transition-all"
                      style={{ width: `${enrichPct}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {[
                    {
                      label: "완료",
                      val: data.enrichment.enriched,
                      color: "text-green-600",
                    },
                    {
                      label: "미보강",
                      val: data.enrichment.pending,
                      color:
                        data.enrichment.pending > 0 ? "text-yellow-500" : "",
                    },
                    {
                      label: "건너뜀",
                      val: data.enrichment.skipped,
                      color: "",
                    },
                    {
                      label: "실패",
                      val: data.enrichment.failed,
                      color: data.enrichment.failed > 0 ? "text-red-500" : "",
                    },
                  ].map(({ label, val, color }) => (
                    <div
                      key={label}
                      className="rounded-md bg-surface-secondary p-2 text-center"
                    >
                      <p className="text-body-xs text-text-secondary">
                        {label}
                      </p>
                      <p className={`font-semibold ${color}`}>{val}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* 최근 크롤러 작업 */}
      {!isLoading && data?.recent_jobs && data.recent_jobs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-text-secondary" />
              최근 크롤러 작업
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.recent_jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between rounded-md bg-surface-secondary px-3 py-2 text-body-sm"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      job.status === "success"
                        ? "default"
                        : job.status === "partial"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {job.status}
                  </Badge>
                  <span className="font-medium">{job.source}</span>
                </div>
                <div className="flex items-center gap-3 text-text-secondary">
                  <span>
                    발견 {job.eventsFound} · 저장 {job.eventsUpserted}
                  </span>
                  <span className="text-body-xs">
                    {job.finishedAt ? formatKst(job.finishedAt) : "—"}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 즉각 처리 필요 */}
      {isLoading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      ) : hasActionItems ? (
        <Card className="border-yellow-400/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              즉각 처리 필요
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.events.needs_end_update > 0 && (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-body-sm">
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    종료 처리 필요 — {data.events.needs_end_update}건
                  </span>
                  <span className="text-text-tertiary">
                    end_date가 지났지만 ended가 아닌 공연
                  </span>
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push("/admin/events?status=on_sale")}
                  >
                    목록 보기
                  </Button>
                  <Button
                    size="sm"
                    loading={fixingEnded}
                    onClick={() => void handleFixEnded()}
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    일괄 업데이트
                  </Button>
                </div>
              </div>
            )}
            {data.unlinked_events > 0 && (
              <ActionRow
                label={`아티스트 미연결 — ${data.unlinked_events}건`}
                description="artist_id가 없는 공연"
                onClick={() => router.push("/admin/events?missing=artist_id")}
              />
            )}
            {data.ticket_opens_soon.map((e) => (
              <ActionRow
                key={e.id}
                label={`티켓 오픈 임박 — ${e.title}`}
                description={`D-${e.d_day} · ${formatKst(e.ticket_open_date)}`}
                badge={<Badge variant="warning">D-{e.d_day}</Badge>}
                onClick={() =>
                  router.push(`/admin/events?q=${encodeURIComponent(e.title)}`)
                }
              />
            ))}
          </CardContent>
        </Card>
      ) : data ? (
        <Card>
          <CardContent className="py-8 text-center text-body-sm text-text-secondary">
            <Ticket className="mx-auto mb-2 h-6 w-6 text-text-tertiary" />
            처리가 필요한 항목이 없습니다.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ActionRow({
  label,
  description,
  badge,
  onClick,
}: {
  label: string;
  description: string;
  badge?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-body-sm transition-colors hover:bg-surface-hover"
      onClick={onClick}
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-text-tertiary">{description}</span>
      </span>
      {badge}
    </button>
  );
}
