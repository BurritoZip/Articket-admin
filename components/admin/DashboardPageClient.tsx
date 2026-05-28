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
  MapPin,
  Music,
  RefreshCw,
  Sparkles,
  Ticket,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatKst } from "@/lib/format-kst";

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

// 파이프라인 단계 정의
const PIPELINE_STEPS = [
  {
    key: "crawl",
    label: "크롤링",
    icon: Database,
    desc: "yes24/melon/interpark 등",
  },
  {
    key: "sweep",
    label: "상태 업데이트",
    icon: RefreshCw,
    desc: "종료/진행중 자동 전환",
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
    desc: "아티스트 정보 채우기",
  },
  {
    key: "merge",
    label: "중복 병합",
    icon: CheckCircle2,
    desc: "완전일치 자동 병합",
  },
] as const;

export function DashboardPageClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [fixingEnded, setFixingEnded] = React.useState(false);

  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ["admin-dashboard-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dashboard/stats");
      if (!res.ok) throw new Error("stats fetch failed");
      return res.json() as Promise<DashboardStats>;
    },
    staleTime: 30_000,
  });

  const handleFixEnded = async () => {
    setFixingEnded(true);
    try {
      const res = await fetch("/api/admin/events/sweep-statuses", {
        method: "POST",
      });
      const json = (await res.json()) as { ok?: boolean; updated?: number };
      if (!res.ok) throw new Error("처리 실패");
      toast.success(`${json.updated ?? 0}건 상태 업데이트`);
      void queryClient.invalidateQueries({
        queryKey: ["admin-dashboard-stats"],
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "실패");
    } finally {
      setFixingEnded(false);
    }
  };

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

  const enrichTotal = data
    ? data.enrichment.enriched +
      data.enrichment.pending +
      data.enrichment.skipped +
      data.enrichment.failed
    : 1;
  const enrichPct = data
    ? Math.round((data.enrichment.enriched / enrichTotal) * 100)
    : 0;
  const queueTotal = data
    ? data.queue.pending +
      data.queue.processing +
      data.queue.done +
      data.queue.failed
    : 0;

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

      {/* 파이프라인 워크플로우 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">데이터 파이프라인</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-0 overflow-x-auto pb-2">
            {PIPELINE_STEPS.map((step, i) => (
              <React.Fragment key={step.key}>
                <div className="flex min-w-[100px] flex-col items-center gap-1.5 px-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-secondary">
                    <step.icon className="h-4 w-4 text-text-secondary" />
                  </div>
                  <span className="text-center text-body-xs font-medium">
                    {step.label}
                  </span>
                  <span className="text-center text-body-xs text-text-tertiary leading-tight">
                    {step.desc}
                  </span>
                  {step.key === "enrich" && data && (
                    <span className="text-body-xs font-semibold text-brand">
                      {enrichPct}%
                    </span>
                  )}
                  {step.key === "fix" && data && (
                    <span className="text-body-xs font-semibold text-green-600">
                      7일{" "}
                      {data.quality_fixes_7d.nulled +
                        data.quality_fixes_7d.deleted}
                      건
                    </span>
                  )}
                  {step.key === "delete" && data && (
                    <span className="text-body-xs font-semibold text-red-500">
                      7일 {data.quality_fixes_7d.deleted}건
                    </span>
                  )}
                </div>
                {i < PIPELINE_STEPS.length - 1 && (
                  <div className="mt-4 h-px flex-1 min-w-[16px] bg-border" />
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-body-xs text-text-tertiary">
              스케줄: Python 크론 오전6시·오후6시 자동 실행 → 크롤링 후 전 단계
              순차 처리
            </p>
          </div>
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
                <div className="flex items-center justify-between text-body-sm">
                  <span className="text-text-secondary">대기 중</span>
                  <span
                    className={`font-semibold ${data.queue.pending > 0 ? "text-yellow-500" : "text-text-primary"}`}
                  >
                    {data.queue.pending}건
                  </span>
                </div>
                <div className="flex items-center justify-between text-body-sm">
                  <span className="text-text-secondary">처리 중</span>
                  <span className="font-semibold">
                    {data.queue.processing}건
                  </span>
                </div>
                <div className="flex items-center justify-between text-body-sm">
                  <span className="text-text-secondary">완료</span>
                  <span className="font-semibold text-green-600">
                    {data.queue.done}건
                  </span>
                </div>
                <div className="flex items-center justify-between text-body-sm">
                  <span className="text-text-secondary">실패</span>
                  <span
                    className={`font-semibold ${data.queue.failed > 0 ? "text-red-500" : "text-text-primary"}`}
                  >
                    {data.queue.failed}건
                  </span>
                </div>
                {data.queue.pending > 0 && (
                  <Button
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => router.push("/admin/ingestion?tab=quality")}
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
                {/* 보강율 바 */}
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
                  <div className="rounded-md bg-surface-secondary p-2 text-center">
                    <p className="text-body-xs text-text-secondary">완료</p>
                    <p className="font-semibold text-green-600">
                      {data.enrichment.enriched}
                    </p>
                  </div>
                  <div className="rounded-md bg-surface-secondary p-2 text-center">
                    <p className="text-body-xs text-text-secondary">미보강</p>
                    <p
                      className={`font-semibold ${data.enrichment.pending > 0 ? "text-yellow-500" : ""}`}
                    >
                      {data.enrichment.pending}
                    </p>
                  </div>
                  <div className="rounded-md bg-surface-secondary p-2 text-center">
                    <p className="text-body-xs text-text-secondary">건너뜀</p>
                    <p className="font-semibold text-text-secondary">
                      {data.enrichment.skipped}
                    </p>
                  </div>
                  <div className="rounded-md bg-surface-secondary p-2 text-center">
                    <p className="text-body-xs text-text-secondary">실패</p>
                    <p
                      className={`font-semibold ${data.enrichment.failed > 0 ? "text-red-500" : ""}`}
                    >
                      {data.enrichment.failed}
                    </p>
                  </div>
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
          <CardContent className="space-y-3">
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
                    end_date가 지났지만 status가 ended가 아닌 공연
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
