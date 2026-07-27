"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { safeJson } from "@/lib/api-handler";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Database,
  CalendarClock,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { CrawlerSourcesTab } from "@/components/admin/CrawlerSourcesTab";
import type { CrawlerJob } from "@/types/crawler";

type ArtistAuditMeta = {
  checkedCount?: number;
  missingCount?: number;
};

function StatusBadge({ status }: { status: CrawlerJob["status"] }) {
  const map = {
    pending: { label: "대기", variant: "secondary" as const, icon: Clock },
    running: { label: "실행중", variant: "outline" as const, icon: Loader2 },
    success: { label: "성공", variant: "default" as const, icon: CheckCircle2 },
    partial: {
      label: "부분성공",
      variant: "outline" as const,
      icon: AlertCircle,
    },
    failed: { label: "실패", variant: "danger" as const, icon: AlertCircle },
  };
  const { label, icon: Icon } = map[status] ?? map.pending;
  return (
    <Badge variant={map[status]?.variant ?? "secondary"} className="gap-1">
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function getArtistAudit(job: CrawlerJob): ArtistAuditMeta {
  const audit = job.meta?.artistAudit;
  if (!audit || typeof audit !== "object") return {};
  return audit as ArtistAuditMeta;
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "-";
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const secs = Math.round((e.getTime() - s.getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function CrawlerPageClient() {
  const { data: jobsData, isLoading } = useQuery({
    queryKey: ["crawler-jobs"],
    queryFn: async () => {
      const res = await fetch("/api/admin/crawler/jobs?limit=30");
      return safeJson(res, { rows: [] as CrawlerJob[] });
    },
  });
  const jobs = jobsData?.rows ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "크롤러" },
        ]}
        title="크롤러 관리"
        description="이벤트 자동 수집 파이프라인을 실행하고 모니터링합니다."
      />

      <Tabs defaultValue="history" className="space-y-6">
        <TabsList>
          <TabsTrigger value="history">실행 이력</TabsTrigger>
          <TabsTrigger value="sources">소스 관리</TabsTrigger>
        </TabsList>

        {/* ── 탭 1: 실행 이력 ── */}
        <TabsContent value="history" className="space-y-6">
          {/* Cron 스케줄 카드 */}
          <Card className="border-border/60 bg-surface">
            <CardContent className="flex items-center gap-4 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted">
                <CalendarClock className="h-4 w-4 text-text-secondary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-label font-semibold text-text-primary">
                  자동 크롤링 스케줄
                </p>
                <p className="text-caption text-text-tertiary">
                  로컬 launchd cron · 하루 2회 06:00 / 18:00 KST
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 실행 이력 테이블 */}
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-h3">실행 이력</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>소스</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead className="text-right">발견</TableHead>
                    <TableHead className="text-right">저장</TableHead>
                    <TableHead className="text-right">스킵</TableHead>
                    <TableHead className="text-right">아티스트 누락</TableHead>
                    <TableHead className="text-right">오류</TableHead>
                    <TableHead>소요시간</TableHead>
                    <TableHead>시작</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="h-24 text-center text-text-secondary"
                      >
                        로딩중...
                      </TableCell>
                    </TableRow>
                  ) : jobs.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="h-24 text-center text-text-secondary"
                      >
                        <Database className="mx-auto mb-2 h-6 w-6 text-text-tertiary" />
                        실행 이력 없음
                      </TableCell>
                    </TableRow>
                  ) : (
                    jobs.map((job) => {
                      const artistAudit = getArtistAudit(job);
                      const missingCount = artistAudit.missingCount ?? 0;
                      return (
                        <TableRow key={job.id}>
                          <TableCell className="font-mono text-body-sm">
                            {job.source_name}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={job.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            {job.events_found}
                          </TableCell>
                          <TableCell className="text-right font-medium text-green-600">
                            {job.events_upserted}
                          </TableCell>
                          <TableCell className="text-right text-text-tertiary">
                            {job.events_skipped}
                          </TableCell>
                          <TableCell
                            className={`text-right ${missingCount > 0 ? "text-amber-600" : "text-text-tertiary"}`}
                          >
                            {missingCount}
                          </TableCell>
                          <TableCell className="text-right text-red-500">
                            {job.error_count}
                          </TableCell>
                          <TableCell className="text-body-sm text-text-secondary">
                            {formatDuration(job.started_at, job.finished_at)}
                          </TableCell>
                          <TableCell className="text-caption text-text-tertiary">
                            {job.created_at
                              ? new Date(job.created_at).toLocaleString("ko-KR")
                              : "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 탭 2: 소스 관리 ── */}
        <TabsContent value="sources">
          <CrawlerSourcesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
