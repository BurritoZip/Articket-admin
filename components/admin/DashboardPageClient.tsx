"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  MapPin,
  Music,
  Ticket,
  Users,
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
}

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
      const res = await fetch("/api/admin/dashboard/fix-ended", {
        method: "POST",
      });
      const json = (await res.json()) as { ok?: boolean; updated?: number; detail?: string };
      if (!res.ok) throw new Error(json.detail ?? "처리 실패");
      toast.success(`${json.updated ?? 0}건 종료 처리 완료`);
      void queryClient.invalidateQueries({ queryKey: ["admin-dashboard-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "일괄 종료 처리 실패");
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

      {isLoading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-8 w-full" />
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
                    일괄 종료 처리
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
