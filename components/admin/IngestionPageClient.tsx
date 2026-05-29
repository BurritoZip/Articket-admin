"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { safeJson } from "@/lib/api-handler";
import { AlertCircle, FileText, Layers, Play } from "lucide-react";
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
import { PageHeader } from "@/components/layout/PageHeader";
import type { IngestionError, RawEventPayload } from "@/types/crawler";

type Tab = "workflows" | "errors" | "raw" | "queue" | "quality";

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
        {(["workflows", "errors", "raw", "queue", "quality"] as Tab[]).map(
          (t) => (
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
                    : t === "queue"
                      ? "AI 큐"
                      : "데이터 품질"}
            </button>
          ),
        )}
      </div>

      {tab === "workflows" && <WorkflowsTab />}
      {tab === "errors" && <ErrorsTab />}
      {tab === "raw" && <RawPayloadsTab />}
      {tab === "queue" && <AIQueueTab />}
      {tab === "quality" && <DataQualityTab />}
    </div>
  );
}

function WorkflowsTab() {
  return (
    <div className="rounded-md border border-border bg-surface-secondary p-6 text-body-sm text-text-secondary">
      <p className="font-medium text-text-primary mb-1">워크플로 자동화 완료</p>
      <p>
        아티스트 보강·이벤트 보강·중복 병합은 파이프라인(대시보드 &gt; 지금
        실행)이 자동으로 처리합니다.
      </p>
      <p className="mt-1">
        오류 로그 / AI 큐 / 데이터 품질 탭에서 상태를 확인하세요.
      </p>
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

// ── 데이터 품질 탭 ──────────────────────────────────────────────────

type QualityLog = {
  entityType: string;
  entityId: string;
  entityTitle: string;
  reason: string;
  method: string;
  geminiReasoning?: string;
};

type GeminiError = { entityType: string; prompt: string; error: string };

type FixLogEntry = {
  id: string;
  entity_type: string;
  field_name: string;
  issue_type: string;
  old_value: string | null;
  fix_method: string;
  fixed_at: string;
  gemini_reasoning: string | null;
  error_msg: string | null;
};

function DataQualityTab() {
  const [fixing, setFixing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [sweeping, setSweeping] = React.useState(false);
  const [merging, setMerging] = React.useState(false);
  const [draining, setDraining] = React.useState(false);
  const [loadingLogs, setLoadingLogs] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const [drainResult, setDrainResult] = React.useState<{
    rounds: number;
    processed: number;
    succeeded: number;
    failed: number;
  } | null>(null);
  const [fixResult, setFixResult] = React.useState<{
    fixed: number;
    queued: number;
  } | null>(null);
  const [deleteResult, setDeleteResult] = React.useState<{
    deleted: number;
    details: QualityLog[];
    geminiErrors: GeminiError[];
  } | null>(null);
  const [sweepResult, setSweepResult] = React.useState<{
    updated: number;
    breakdown: Record<string, number>;
  } | null>(null);
  const [mergeResult, setMergeResult] = React.useState<{
    artists: number;
    venues: number;
  } | null>(null);
  const [fixLogs, setFixLogs] = React.useState<FixLogEntry[] | null>(null);

  const runFix = async () => {
    setFixing(true);
    setInlineError(null);
    const id = toast.loading("이상 필드 자동 수정 중...");
    try {
      const res = await fetch("/api/admin/data-quality/auto-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setFixResult({ fixed: json.fixed ?? 0, queued: json.queued ?? 0 });
      toast.success(`필드 수정 ${json.fixed}건, AI 큐 ${json.queued}건`, {
        id,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInlineError(`자동 수정 실패: ${msg}`);
      toast.dismiss(id);
    } finally {
      setFixing(false);
    }
  };

  const runDelete = async () => {
    setDeleting(true);
    setInlineError(null);
    const id = toast.loading("Gemini 분석 + 불량 데이터 삭제 중...");
    try {
      const res = await fetch("/api/admin/data-quality/auto-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDeleteResult({
        deleted: json.deleted ?? 0,
        details: json.details ?? [],
        geminiErrors: json.geminiErrors ?? [],
      });
      toast.success(`${json.deleted}건 삭제 완료`, { id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInlineError(`삭제 실패: ${msg}`);
      toast.dismiss(id);
    } finally {
      setDeleting(false);
    }
  };

  const runSweep = async () => {
    setSweeping(true);
    const id = toast.loading("이벤트 상태 업데이트 중...");
    try {
      const res = await fetch("/api/admin/events/sweep-statuses", {
        method: "POST",
      });
      const json = await res.json();
      setSweepResult({
        updated: json.updated ?? 0,
        breakdown: json.breakdown ?? {},
      });
      toast.success(`${json.updated}건 상태 업데이트`, { id });
    } catch {
      toast.error("상태 업데이트 실패", { id });
    } finally {
      setSweeping(false);
    }
  };

  const runMerge = async () => {
    setMerging(true);
    const id = toast.loading("중복 자동 병합 중...");
    try {
      const [artistRes, venueRes] = await Promise.all([
        fetch("/api/admin/artists/auto-merge", { method: "POST" }).then((r) =>
          r.json(),
        ),
        fetch("/api/admin/venues/auto-merge", { method: "POST" }).then((r) =>
          r.json(),
        ),
      ]);
      setMergeResult({
        artists: artistRes.merged ?? 0,
        venues: venueRes.merged ?? 0,
      });
      toast.success(
        `아티스트 ${artistRes.merged ?? 0}건, 공연장 ${venueRes.merged ?? 0}건 병합`,
        { id },
      );
    } catch {
      toast.error("자동 병합 실패", { id });
    } finally {
      setMerging(false);
    }
  };

  const runDrain = async () => {
    setDraining(true);
    const id = toast.loading("AI 큐 전체 처리 중... (최대 5분)");
    try {
      const res = await fetch("/api/admin/ingestion/queue/drain", {
        method: "POST",
      });
      const json = await res.json();
      setDrainResult({
        rounds: json.rounds ?? 0,
        processed: json.processed ?? 0,
        succeeded: json.succeeded ?? 0,
        failed: json.failed ?? 0,
      });
      toast.success(`${json.processed}건 처리 완료 (${json.rounds}라운드)`, {
        id,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInlineError(`큐 처리 실패: ${msg}`);
      toast.dismiss(id);
    } finally {
      setDraining(false);
    }
  };

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch("/api/admin/data-quality/logs?limit=100");
      const json = await res.json();
      setFixLogs(json.logs ?? []);
    } catch (e) {
      setInlineError(
        `이력 조회 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setLoadingLogs(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>데이터 품질 자동 관리</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={runFix} disabled={fixing}>
              {fixing ? "수정 중..." : "이상 필드 자동 수정"}
            </Button>
            <Button variant="danger" onClick={runDelete} disabled={deleting}>
              {deleting ? "Gemini 분석 중..." : "불량 데이터 삭제 (Gemini)"}
            </Button>
            <Button variant="secondary" onClick={runSweep} disabled={sweeping}>
              {sweeping ? "업데이트 중..." : "공연 상태 업데이트"}
            </Button>
            <Button variant="secondary" onClick={runMerge} disabled={merging}>
              {merging ? "병합 중..." : "중복 자동 병합"}
            </Button>
            <Button onClick={runDrain} disabled={draining}>
              {draining ? "처리 중... (최대 5분)" : "AI 큐 전체 처리"}
            </Button>
          </div>

          {/* 인라인 에러 */}
          {inlineError && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-body-sm text-red-700">
              <span className="font-semibold">오류:</span> {inlineError}
              <button
                className="ml-2 text-red-400 hover:text-red-600"
                onClick={() => setInlineError(null)}
              >
                ✕
              </button>
            </div>
          )}

          {fixResult && (
            <div className="rounded-md bg-surface-secondary p-3 text-body-sm">
              <span className="font-medium">수정 결과:</span> 필드 수정{" "}
              <span className="font-semibold text-green-600">
                {fixResult.fixed}건
              </span>
              , AI 큐 등록{" "}
              <span className="font-semibold text-blue-600">
                {fixResult.queued}건
              </span>
            </div>
          )}

          {deleteResult && (
            <div className="space-y-2">
              <div className="rounded-md bg-surface-secondary p-3 text-body-sm">
                <span className="font-medium">삭제 결과:</span>{" "}
                <span className="font-semibold text-red-600">
                  {deleteResult.deleted}건 삭제
                </span>
              </div>

              {/* Gemini API 에러 */}
              {deleteResult.geminiErrors.length > 0 && (
                <div className="space-y-1">
                  {deleteResult.geminiErrors.map((e, i) => (
                    <div
                      key={i}
                      className="rounded-md border border-red-200 bg-red-50 p-2 text-body-xs"
                    >
                      <span className="font-semibold text-red-700">
                        Gemini 오류 ({e.entityType}):
                      </span>{" "}
                      <span className="text-red-600">{e.error}</span>
                      {e.prompt && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-text-tertiary">
                            전송한 프롬프트 보기
                          </summary>
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-text-secondary">
                            {e.prompt}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {deleteResult.details.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>유형</TableHead>
                      <TableHead>값</TableHead>
                      <TableHead>판단 방식</TableHead>
                      <TableHead>Gemini 이유</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deleteResult.details.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge variant="secondary">{d.entityType}</Badge>
                        </TableCell>
                        <TableCell
                          className="max-w-[160px] truncate text-body-sm"
                          title={d.entityTitle}
                        >
                          {d.entityTitle}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              d.method === "gemini" ? "default" : "outline"
                            }
                          >
                            {d.method === "gemini" ? "🤖 Gemini" : "📏 규칙"}
                          </Badge>
                          <span className="ml-1 text-body-xs text-text-tertiary">
                            {d.reason}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[200px] text-body-xs text-text-secondary">
                          {d.geminiReasoning ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}

          {sweepResult && (
            <div className="rounded-md bg-surface-secondary p-3 text-body-sm">
              <span className="font-medium">상태 업데이트:</span>{" "}
              <span className="font-semibold text-green-600">
                {sweepResult.updated}건
              </span>
              {" — "}
              {Object.entries(sweepResult.breakdown)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => `${k} ${v}`)
                .join(", ")}
            </div>
          )}

          {mergeResult && (
            <div className="rounded-md bg-surface-secondary p-3 text-body-sm">
              <span className="font-medium">자동 병합:</span> 아티스트{" "}
              <span className="font-semibold text-green-600">
                {mergeResult.artists}건
              </span>
              , 공연장{" "}
              <span className="font-semibold text-green-600">
                {mergeResult.venues}건
              </span>
            </div>
          )}

          {drainResult && (
            <div className="rounded-md bg-surface-secondary p-3 text-body-sm">
              <span className="font-medium">AI 큐 처리:</span>{" "}
              <span className="font-semibold text-green-600">
                {drainResult.processed}건
              </span>{" "}
              처리 ({drainResult.rounds}라운드) — 성공{" "}
              <span className="font-semibold">{drainResult.succeeded}</span>,
              실패{" "}
              <span
                className={`font-semibold ${drainResult.failed > 0 ? "text-red-500" : ""}`}
              >
                {drainResult.failed}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 수정 이력 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm">수정·삭제 이력</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={loadLogs}
            disabled={loadingLogs}
          >
            {loadingLogs ? "로딩 중..." : "최근 100건 조회"}
          </Button>
        </CardHeader>
        {fixLogs && (
          <CardContent>
            {fixLogs.length === 0 ? (
              <p className="text-body-sm text-text-secondary">이력 없음</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>시각</TableHead>
                    <TableHead>유형</TableHead>
                    <TableHead>필드</TableHead>
                    <TableHead>기존값</TableHead>
                    <TableHead>처리</TableHead>
                    <TableHead>판단 / 에러</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fixLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-body-xs text-text-tertiary">
                        {new Date(log.fixed_at).toLocaleString("ko-KR", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{log.entity_type}</Badge>
                      </TableCell>
                      <TableCell className="text-body-xs">
                        {log.field_name}
                      </TableCell>
                      <TableCell
                        className="max-w-[140px] truncate text-body-xs"
                        title={log.old_value ?? ""}
                      >
                        {log.old_value ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            log.fix_method === "deleted"
                              ? "danger"
                              : log.fix_method === "queued_ai"
                                ? "default"
                                : "outline"
                          }
                        >
                          {log.fix_method}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[220px] text-body-xs">
                        {log.error_msg ? (
                          <span className="text-red-500">{log.error_msg}</span>
                        ) : log.gemini_reasoning ? (
                          <span className="text-text-secondary">
                            {log.gemini_reasoning}
                          </span>
                        ) : (
                          <span className="text-text-tertiary">
                            {log.issue_type}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
