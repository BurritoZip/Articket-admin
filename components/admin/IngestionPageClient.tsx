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
            <div className="grid gap-3 md:grid-cols-5">
              <Metric label="스캔" value={result.scannedCount} />
              <Metric label="연결" value={result.linkedCount} />
              <Metric
                label="매칭/생성"
                value={result.createdOrMatchedArtistCount}
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

function AIQueueTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["ai-queue"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ingestion/queue?limit=50");
      return safeJson(res, {
        rows: [] as Array<{
          id: string;
          task_type: string;
          status: string;
          created_at: string;
          attempts: number;
        }>,
        total: 0,
      });
    },
  });

  const rows = data?.rows ?? [];

  return (
    <Card>
      <CardHeader className="border-b border-border pb-4">
        <CardTitle className="flex items-center gap-2 text-h3">
          <Layers className="h-4 w-4" />
          AI 처리 큐 ({data?.total ?? 0})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>작업 유형</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">시도</TableHead>
              <TableHead>생성</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center h-20 text-text-secondary"
                >
                  로딩중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center h-20 text-text-secondary"
                >
                  큐 비어있음
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-caption">
                    {r.task_type}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "done"
                          ? "default"
                          : r.status === "failed"
                            ? "danger"
                            : "secondary"
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-caption">
                    {r.attempts}
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
