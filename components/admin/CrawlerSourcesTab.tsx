"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  XCircle,
  CircleDashed,
} from "lucide-react";
import { toast } from "sonner";
import { safeJson } from "@/lib/api-handler";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Skeleton } from "@/components/ui/Skeleton";
import { CrawlerSourceSheet } from "@/components/admin/CrawlerSourceSheet";
import type { CrawlerSource, CrawlerJob, CrawlerJobStatus } from "@/types/crawler";

// 소스별 가장 최근 job 인덱스
type SourceJobMap = Record<string, CrawlerJob>;

function buildSourceJobMap(jobs: CrawlerJob[]): SourceJobMap {
  const map: SourceJobMap = {};
  for (const job of jobs) {
    if (!map[job.source_name]) {
      map[job.source_name] = job; // 내림차순 정렬이므로 첫 번째 = 최신
    }
  }
  return map;
}

function JobStatusBadge({ status }: { status: CrawlerJobStatus }) {
  const map: Record<CrawlerJobStatus, { label: string; variant: "success" | "secondary" | "outline" | "warning" | "danger"; Icon: React.FC<{ className?: string }> }> = {
    success: { label: "성공", variant: "success", Icon: CheckCircle2 },
    partial: { label: "부분", variant: "warning", Icon: AlertTriangle },
    running: { label: "실행중", variant: "outline", Icon: Loader2 },
    pending: { label: "대기", variant: "secondary", Icon: Clock },
    failed: { label: "실패", variant: "danger", Icon: XCircle },
  };
  const { label, variant, Icon } = map[status] ?? map.pending;
  return (
    <Badge variant={variant} className="gap-1">
      <Icon className={`h-3 w-3 ${status === "running" ? "animate-spin" : ""}`} />
      {label}
    </Badge>
  );
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "-";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  return `${Math.floor(hrs / 24)}일 전`;
}

export function CrawlerSourcesTab() {
  const queryClient = useQueryClient();
  const [selectedSource, setSelectedSource] = React.useState<CrawlerSource | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  const { data: sourcesData, isLoading: sourcesLoading } = useQuery({
    queryKey: ["crawler-sources"],
    queryFn: async () => {
      const res = await fetch("/api/admin/crawler/sources");
      return safeJson(res, { rows: [] as CrawlerSource[] });
    },
  });
  const sources = sourcesData?.rows ?? [];

  const { data: jobsData } = useQuery({
    queryKey: ["crawler-jobs", "all"],
    queryFn: async () => {
      const res = await fetch("/api/admin/crawler/jobs?limit=100");
      return safeJson(res, { rows: [] as CrawlerJob[] });
    },
  });
  const sourceJobMap = buildSourceJobMap(jobsData?.rows ?? []);

  const handleToggle = async (source: CrawlerSource, enabled: boolean) => {
    setTogglingId(source.id);
    try {
      const res = await fetch(`/api/admin/crawler/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? "변경 실패");
      toast.success(`${source.display_name} ${enabled ? "활성화" : "비활성화"} 완료`);
      void queryClient.invalidateQueries({ queryKey: ["crawler-sources"] });
    } catch (e) {
      toast.error("변경 실패", {
        description: e instanceof Error ? e.message : "알 수 없는 오류",
      });
    } finally {
      setTogglingId(null);
    }
  };

  const handleEdit = (source: CrawlerSource) => {
    setSelectedSource(source);
    setSheetOpen(true);
  };

  const handleSheetSaved = (updated: CrawlerSource) => {
    void queryClient.invalidateQueries({ queryKey: ["crawler-sources"] });
    setSelectedSource(updated);
  };

  if (sourcesLoading) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">소스</TableHead>
              <TableHead className="w-20">활성화</TableHead>
              <TableHead className="w-24">최근 상태</TableHead>
              <TableHead className="text-right w-28">수집 건수</TableHead>
              <TableHead className="w-32">마지막 실행</TableHead>
              <TableHead className="w-20 text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-text-tertiary">
                  <CircleDashed className="mx-auto mb-2 h-6 w-6" />
                  등록된 소스 없음
                </TableCell>
              </TableRow>
            ) : (
              sources.map((source) => {
                const latestJob = sourceJobMap[source.name];
                const eventsFound = latestJob?.events_found ?? null;
                const isZero = eventsFound === 0;
                const consecZero = source.config.consecutiveZeroCount ?? 0;
                const isStructureWarning = consecZero >= 1;

                return (
                  <TableRow
                    key={source.id}
                    className={isStructureWarning ? "bg-warning-weak/20" : undefined}
                  >
                    {/* 소스명 */}
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-body-sm font-medium text-text-primary">
                          {source.display_name}
                        </span>
                        <span className="font-mono text-caption text-text-tertiary">
                          {source.name}
                        </span>
                      </div>
                    </TableCell>

                    {/* 활성화 스위치 */}
                    <TableCell>
                      <Switch
                        checked={source.enabled}
                        disabled={togglingId === source.id}
                        onCheckedChange={(checked) =>
                          void handleToggle(source, checked)
                        }
                        aria-label={`${source.display_name} 활성화`}
                      />
                    </TableCell>

                    {/* 최근 상태 */}
                    <TableCell>
                      {latestJob ? (
                        <JobStatusBadge status={latestJob.status} />
                      ) : (
                        <span className="text-caption text-text-tertiary">-</span>
                      )}
                    </TableCell>

                    {/* 수집 건수 */}
                    <TableCell className="text-right">
                      {eventsFound !== null ? (
                        <div className="flex items-center justify-end gap-1.5">
                          {isStructureWarning && (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          )}
                          <span
                            className={`text-body-sm font-medium ${
                              isZero
                                ? "text-danger"
                                : "text-text-primary"
                            }`}
                          >
                            {eventsFound}건
                          </span>
                        </div>
                      ) : (
                        <span className="text-caption text-text-tertiary">-</span>
                      )}
                    </TableCell>

                    {/* 마지막 실행 */}
                    <TableCell className="text-caption text-text-tertiary">
                      {timeAgo(latestJob?.created_at ?? null)}
                    </TableCell>

                    {/* 편집 버튼 */}
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(source)}
                        className="gap-1.5"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        편집
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 구조 변경 경고 안내 */}
      {sources.some((s) => (s.config.consecutiveZeroCount ?? 0) >= 3) && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-body-sm text-amber-800">
            일부 소스에서 연속으로 0건 수집이 감지됐습니다.{" "}
            <strong>[편집]</strong>을 눌러 CSS 선택자를 업데이트해 주세요.
          </p>
        </div>
      )}

      {/* 선택자 편집 Sheet */}
      <CrawlerSourceSheet
        source={selectedSource}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSaved={handleSheetSaved}
      />
    </>
  );
}
