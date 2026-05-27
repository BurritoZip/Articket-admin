"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { safeJson } from "@/lib/api-handler";
import { AlertCircle, FileText, Layers, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { PageHeader } from "@/components/layout/PageHeader";
import type { IngestionError, RawEventPayload } from "@/types/crawler";

type Tab = "workflows" | "errors" | "raw" | "queue";

type ArtistBackfillResult = {
  scannedCount: number;
  linkedCount: number;
  createdOrMatchedArtistCount: number;
  catalogCreatedOrMatchedCount: number;
  enrichmentQueuedCount: number;
  unresolvedCount: number;
  dryRun: boolean;
  issues: Array<{
    eventId: string;
    eventTitle: string;
    reason: string;
    artistCandidates: string[];
  }>;
};

export function IngestionPageClient() {
  const [tab, setTab] = React.useState<Tab>("workflows");

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "인제스천" },
        ]}
        title="인제스천 모니터링"
        description="크롤링 오류, 원본 페이로드, AI 큐를 확인합니다."
      />

      <div className="flex gap-1 border-b border-border">
        {(["workflows", "errors", "raw", "queue"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-body-sm font-medium transition-colors ${
              tab === t
                ? "border-b-2 border-primary text-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {t === "workflows"
              ? "워크플로"
              : t === "errors"
                ? "오류 로그"
                : t === "raw"
                  ? "원본 페이로드"
                  : "AI 큐"}
          </button>
        ))}
      </div>

      {tab === "workflows" && <WorkflowsTab />}
      {tab === "errors" && <ErrorsTab />}
      {tab === "raw" && <RawPayloadsTab />}
      {tab === "queue" && <AIQueueTab />}
    </div>
  );
}

function WorkflowsTab() {
  const queryClient = useQueryClient();
  const [limit, setLimit] = React.useState("100");
  const [dryRun, setDryRun] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<ArtistBackfillResult | null>(null);

  const runBackfill = async () => {
    setRunning(true);
    const id = toast.loading("아티스트 백필 실행 중...");
    try {
      const res = await fetch("/api/admin/ingestion/artist-backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit: Math.max(1, parseInt(limit) || 100),
          dryRun,
        }),
      });
      const json = await safeJson<{
        ok?: boolean;
        result?: ArtistBackfillResult;
        error?: string;
        detail?: string;
      }>(res, {});
      if (!res.ok || !json.result) {
        throw new Error(json.detail ?? json.error ?? "백필 실행 실패");
      }
      setResult(json.result);
      toast.success(
        `완료: 연결 ${json.result.linkedCount}건, 미해결 ${json.result.unresolvedCount}건`,
        { id },
      );
      void queryClient.invalidateQueries({ queryKey: ["ingestion-errors"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-queue"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "오류", { id });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="flex items-center gap-2 text-h3">
            <Sparkles className="h-4 w-4" />
            아티스트 백필
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4 p-5">
          <div className="space-y-1">
            <Label htmlFor="artist-backfill-limit">처리 개수</Label>
            <Input
              id="artist-backfill-limit"
              type="number"
              min={1}
              max={500}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-28"
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <input
              id="artist-backfill-dry-run"
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="artist-backfill-dry-run">Dry Run</Label>
          </div>
          <Button loading={running} onClick={() => void runBackfill()}>
            <Play className="h-4 w-4" />
            실행
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="text-h3">
              실행 결과{result.dryRun ? " (Dry Run)" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <div className="grid gap-3 md:grid-cols-6">
              <Metric label="스캔" value={result.scannedCount} />
              <Metric label="연결" value={result.linkedCount} />
              <Metric
                label="대표 매칭"
                value={result.createdOrMatchedArtistCount}
              />
              <Metric
                label="출연진 DB"
                value={result.catalogCreatedOrMatchedCount}
              />
              <Metric label="보강 큐" value={result.enrichmentQueuedCount} />
              <Metric label="미해결" value={result.unresolvedCount} />
            </div>
            {result.issues.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>공연</TableHead>
                    <TableHead>사유</TableHead>
                    <TableHead>후보</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.issues.map((issue) => (
                    <TableRow key={issue.eventId}>
                      <TableCell className="max-w-sm truncate">
                        {issue.eventTitle}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{issue.reason}</Badge>
                      </TableCell>
                      <TableCell className="text-body-sm text-text-secondary">
                        {issue.artistCandidates.join(", ") || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted p-3">
      <p className="text-caption text-text-secondary">{label}</p>
      <p className="mt-1 text-h3">{value}</p>
    </div>
  );
}

function ErrorsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["ingestion-errors"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ingestion/errors?limit=50");
      return safeJson(res, { rows: [] as IngestionError[], total: 0 });
    },
  });

  const rows = data?.rows ?? [];

  return (
    <Card>
      <CardHeader className="border-b border-border pb-4">
        <CardTitle className="flex items-center gap-2 text-h3">
          <AlertCircle className="h-4 w-4 text-red-500" />
          오류 로그 ({data?.total ?? 0})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>소스</TableHead>
              <TableHead>단계</TableHead>
              <TableHead>오류</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>시각</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center h-20 text-text-secondary"
                >
                  로딩중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center h-20 text-text-secondary"
                >
                  오류 없음
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-caption">
                    {r.source_name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-caption">
                      {r.step}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-body-sm text-red-600">
                    {r.error_message}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-caption text-text-tertiary">
                    {r.source_url ?? "-"}
                  </TableCell>
                  <TableCell className="text-caption text-text-tertiary">
                    {new Date(r.created_at).toLocaleString("ko-KR")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RawPayloadsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["raw-payloads"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ingestion/raw-payloads?limit=50");
      return safeJson(res, { rows: [] as RawEventPayload[], total: 0 });
    },
  });

  const rows = data?.rows ?? [];

  return (
    <Card>
      <CardHeader className="border-b border-border pb-4">
        <CardTitle className="flex items-center gap-2 text-h3">
          <FileText className="h-4 w-4" />
          원본 페이로드 ({data?.total ?? 0})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>소스</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>처리</TableHead>
              <TableHead>Dedup Key</TableHead>
              <TableHead>수집시각</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center h-20 text-text-secondary"
                >
                  로딩중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center h-20 text-text-secondary"
                >
                  데이터 없음
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-caption">
                    {r.source_name}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-caption text-text-tertiary">
                    <a
                      href={r.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {r.source_url}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.processed ? "default" : "secondary"}>
                      {r.processed ? "처리됨" : "미처리"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-caption text-text-tertiary">
                    {r.dedup_key?.slice(0, 12) ?? "-"}
                  </TableCell>
                  <TableCell className="text-caption text-text-tertiary">
                    {new Date(r.crawled_at).toLocaleString("ko-KR")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

type QueueRow = {
  id: string;
  task_type: string;
  status: string;
  priority: number;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  processed_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  processing: "처리중",
  done: "완료",
  failed: "실패",
  skipped: "건너뜀",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "danger" | "success" | "outline"
> = {
  pending: "secondary",
  processing: "outline",
  done: "success",
  failed: "danger",
  skipped: "outline",
};

const TASK_LABEL: Record<string, string> = {
  clean_data: "데이터 보강",
  normalize_venue: "공연장 정규화",
  deduplicate_artist: "아티스트 중복 제거",
  ocr_timetable: "타임테이블 OCR",
  parse_dates: "날짜 파싱",
  classify_genre: "장르 분류",
  summarize_event: "이벤트 요약",
  detect_duplicates: "중복 탐지",
  match_artist: "아티스트 매칭",
};

function getTaskLabel(row: QueueRow): string {
  const base = TASK_LABEL[row.task_type] ?? row.task_type;
  const target = row.payload?.target as string | undefined;
  if (target === "artist_profile_enrichment") return "아티스트 프로필 보강";
  return base;
}

function getEntityLabel(row: QueueRow): string {
  const name =
    (row.payload?.artistName as string) ??
    (row.payload?.name as string) ??
    row.entity_id ??
    "";
  const type =
    row.entity_type === "artist"
      ? "🎤"
      : row.entity_type === "venue"
        ? "🏟️"
        : row.entity_type === "event"
          ? "🎪"
          : "📦";
  return name ? `${type} ${name}` : type;
}

function AIQueueTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [clearing, setClearing] = React.useState<string | null>(null);
  const [runningWorker, setRunningWorker] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-queue", statusFilter],
    queryFn: async () => {
      const q = new URLSearchParams({ limit: "200" });
      if (statusFilter !== "all") q.set("status", statusFilter);
      const res = await fetch(`/api/admin/ingestion/queue?${q.toString()}`);
      return safeJson(res, {
        rows: [] as QueueRow[],
        total: 0,
        byStatus: {} as Record<string, number>,
      });
    },
    refetchInterval: 10_000,
  });

  const rows = data?.rows ?? [];
  const byStatus = data?.byStatus ?? {};
  const totalAll = Object.values(byStatus).reduce((s, c) => s + c, 0);

  const clearByStatus = async (st: string) => {
    setClearing(st);
    try {
      const res = await fetch(
        `/api/admin/ingestion/queue?status=${st}&confirm=true`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { deleted?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "삭제 실패");
      toast.success(`${json.deleted ?? 0}건 삭제 완료`);
      void queryClient.invalidateQueries({ queryKey: ["ai-queue"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setClearing(null);
    }
  };

  const runWorker = async () => {
    setRunningWorker(true);
    try {
      const res = await fetch("/api/admin/artists/enrich?limit=20");
      const json = (await res.json()) as {
        processed?: number;
        succeeded?: number;
        failed?: number;
      };
      toast.success(
        `워커 실행 완료: ${json.processed ?? 0}건 처리, 성공 ${json.succeeded ?? 0}건`,
      );
      void queryClient.invalidateQueries({ queryKey: ["ai-queue"] });
    } catch {
      toast.error("워커 실행 실패");
    } finally {
      setRunningWorker(false);
    }
  };

  const STATUS_TABS = [
    "all",
    "pending",
    "processing",
    "done",
    "failed",
    "skipped",
  ];

  return (
    <Card>
      <CardHeader className="border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-h3">
            <Layers className="h-4 w-4" />
            AI 처리 큐
            <Badge variant="secondary" className="ml-1">
              전체 {totalAll}
            </Badge>
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={runningWorker}
              onClick={() => void runWorker()}
            >
              <Play className="mr-1 h-3 w-3" />
              워커 실행 (20건)
            </Button>
            {byStatus["done"] > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={clearing === "done"}
                onClick={() => void clearByStatus("done")}
              >
                완료 {byStatus["done"]}건 정리
              </Button>
            )}
            {byStatus["failed"] > 0 && (
              <Button
                size="sm"
                variant="danger-weak"
                disabled={clearing === "failed"}
                onClick={() => void clearByStatus("failed")}
              >
                실패 {byStatus["failed"]}건 삭제
              </Button>
            )}
          </div>
        </div>

        {/* 상태 탭 */}
        <div className="mt-3 flex flex-wrap gap-1">
          {STATUS_TABS.map((st) => {
            const cnt = st === "all" ? totalAll : (byStatus[st] ?? 0);
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`rounded-full px-3 py-1 text-caption font-medium transition-colors ${
                  statusFilter === st
                    ? "bg-primary text-white"
                    : "bg-surface-muted text-text-secondary hover:bg-surface-hover"
                }`}
              >
                {st === "all" ? "전체" : (STATUS_LABEL[st] ?? st)}{" "}
                {cnt > 0 && <span className="opacity-80">({cnt})</span>}
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>대상</TableHead>
              <TableHead>작업</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">시도</TableHead>
              <TableHead>등록</TableHead>
              <TableHead>처리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-20 text-center text-text-secondary"
                >
                  로딩중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-20 text-center text-text-secondary"
                >
                  {statusFilter === "all"
                    ? "큐 비어있음"
                    : `${STATUS_LABEL[statusFilter] ?? statusFilter} 항목 없음`}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[180px] truncate text-body-sm font-medium">
                    {getEntityLabel(r)}
                  </TableCell>
                  <TableCell className="text-body-sm text-text-secondary">
                    {getTaskLabel(r)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge
                        variant={STATUS_VARIANT[r.status] ?? "outline"}
                        className="w-fit"
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                      {r.error && (
                        <p className="max-w-[200px] truncate text-[10px] text-red-500">
                          {r.error}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-caption text-text-tertiary">
                    {r.attempts}/{r.max_attempts}
                  </TableCell>
                  <TableCell className="text-caption text-text-tertiary whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("ko-KR", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="text-caption text-text-tertiary whitespace-nowrap">
                    {r.processed_at
                      ? new Date(r.processed_at).toLocaleString("ko-KR", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
