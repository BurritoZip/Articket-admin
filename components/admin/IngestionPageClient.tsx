"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FileText, Layers } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import type { IngestionError, RawEventPayload } from "@/types/crawler";

type Tab = "errors" | "raw" | "queue";

export function IngestionPageClient() {
  const [tab, setTab] = React.useState<Tab>("errors");

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
        {(["errors", "raw", "queue"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-body-sm font-medium transition-colors ${
              tab === t
                ? "border-b-2 border-primary text-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {t === "errors"
              ? "오류 로그"
              : t === "raw"
                ? "원본 페이로드"
                : "AI 큐"}
          </button>
        ))}
      </div>

      {tab === "errors" && <ErrorsTab />}
      {tab === "raw" && <RawPayloadsTab />}
      {tab === "queue" && <AIQueueTab />}
    </div>
  );
}

function ErrorsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["ingestion-errors"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ingestion/errors?limit=50");
      if (!res.ok) return { rows: [] as IngestionError[], total: 0 };
      return res.json() as Promise<{ rows: IngestionError[]; total: number }>;
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
      if (!res.ok) return { rows: [] as RawEventPayload[], total: 0 };
      return res.json() as Promise<{ rows: RawEventPayload[]; total: number }>;
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
      if (!res.ok)
        return {
          rows: [] as Array<{
            id: string;
            task_type: string;
            status: string;
            created_at: string;
            attempts: number;
          }>,
          total: 0,
        };
      return res.json() as Promise<{
        rows: Array<{
          id: string;
          task_type: string;
          status: string;
          created_at: string;
          attempts: number;
        }>;
        total: number;
      }>;
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
