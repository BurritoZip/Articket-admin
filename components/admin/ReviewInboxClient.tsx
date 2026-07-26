"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface ProposalRow {
  id: string;
  name: string;
  name_en: string | null;
  name_proposal: string;
  name_proposal_meta: {
    name_en?: string | null;
    aliases?: string[];
    country?: string | null;
  } | null;
}

type Action = "approve" | "reject" | "delete_artist";

export function ReviewInboxClient() {
  const qc = useQueryClient();

  const { data: proposals } = useQuery({
    queryKey: ["artist-name-proposals"],
    queryFn: async () => {
      const res = await fetch("/api/admin/artists/name-proposals");
      if (!res.ok) throw new Error("제안 조회 실패");
      return res.json() as Promise<{ rows: ProposalRow[]; total: number }>;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["admin-dashboard-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dashboard/stats");
      if (!res.ok) throw new Error("stats 조회 실패");
      return res.json() as Promise<{
        unlinked_events: number;
        timetable_unmatched_unresolved: number;
        app_errors_unresolved: number;
      }>;
    },
    staleTime: 30_000,
  });

  const { mutate: resolve, isPending } = useMutation({
    mutationFn: async (v: { id: string; action: Action }) => {
      const res = await fetch("/api/admin/artists/name-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      const json = (await res.json()) as { detail?: string };
      if (!res.ok) throw new Error(json.detail ?? "처리 실패");
      return json;
    },
    onSuccess: (_, v) => {
      toast.success(
        v.action === "approve"
          ? "이름 교체됨"
          : v.action === "delete_artist"
            ? "아티스트 삭제됨"
            : "제안 거절됨",
      );
      void qc.invalidateQueries({ queryKey: ["artist-name-proposals"] });
      void qc.invalidateQueries({ queryKey: ["admin-artists-list"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = proposals?.rows ?? [];

  // 인라인 처리는 아직 없고, 개수 + 해당 화면 링크로 모으는 판단 큐들
  const queues = [
    {
      label: "미연결 이벤트",
      count: stats?.unlinked_events ?? 0,
      href: "/admin/events?filter=no_artist_link",
      hint: "아티스트 연결 필요",
    },
    {
      label: "타임테이블 미매칭",
      count: stats?.timetable_unmatched_unresolved ?? 0,
      href: "/admin/timetable-unmatched",
      hint: "라인업 아티스트 매칭",
    },
    {
      label: "예매 링크 이슈",
      count: 0,
      href: "/admin/booking-issues",
      hint: "예매처 링크 확인",
    },
    {
      label: "아티스트 중복",
      count: 0,
      href: "/admin/artists",
      hint: "중복 검토 → 병합",
    },
    {
      label: "공연장 중복",
      count: 0,
      href: "/admin/venues",
      hint: "중복 검토 → 병합",
    },
    {
      label: "앱 에러",
      count: stats?.app_errors_unresolved ?? 0,
      href: "/admin/error-logs",
      hint: "런타임 오류 확인",
    },
  ];

  return (
    <div className="space-y-6">
      {/* 이름 제안 — 인라인 승인/거절/삭제 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            이름 교정 제안
            {rows.length > 0 && <Badge variant="warning">{rows.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              대기 중인 이름 제안이 없습니다.
            </p>
          )}
          {rows.map((r) => {
            const aliases = r.name_proposal_meta?.aliases ?? [];
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <span className="text-muted-foreground line-through">
                    {r.name}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-semibold">{r.name_proposal}</span>
                  {r.name_proposal_meta?.name_en && (
                    <Badge variant="secondary" className="text-[10px]">
                      EN: {r.name_proposal_meta.name_en}
                    </Badge>
                  )}
                  {aliases.slice(0, 3).map((a) => (
                    <Badge key={a} variant="outline" className="text-[10px]">
                      {a}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={isPending}
                    onClick={() => resolve({ id: r.id, action: "approve" })}
                  >
                    승인
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={isPending}
                    onClick={() => resolve({ id: r.id, action: "reject" })}
                  >
                    거절
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive"
                    disabled={isPending}
                    onClick={() =>
                      resolve({ id: r.id, action: "delete_artist" })
                    }
                  >
                    삭제
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* 다른 판단 큐 — 개수 + 해당 화면 링크 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {queues.map((q) => (
          <Link key={q.label} href={q.href}>
            <Card className="transition-colors hover:border-muted-foreground">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <div className="text-sm font-medium">{q.label}</div>
                  <div className="text-xs text-muted-foreground">{q.hint}</div>
                </div>
                {q.count > 0 && <Badge variant="warning">{q.count}</Badge>}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
