"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import {
  DEFAULT_ADMIN_PAGE_SIZE,
  type AdminListPagination as PaginationMeta,
  type AdminPageSize,
} from "@/lib/admin-pagination";
import { formatKst } from "@/lib/format-kst";

interface IssueRow {
  id: string;
  event_id: string | null;
  event_title: string | null;
  reason: string;
  platform: string;
  app_user_id: string | null;
  created_at: string;
  resolved: boolean;
  events: { id: string; title: string; booking_url: string | null } | null;
}

interface IssuesResponse {
  data: IssueRow[];
  meta: PaginationMeta;
}

/**
 * 예매 URL 연결 액션 — 이슈의 공연에 booking_url 을 직접 채워 해결한다.
 * events/[id] PATCH 가 booking_url 을 locked_fields 에 넣어 이후 크롤이 덮지 않는다.
 * resolved 는 booking_url 유무로 자동 판정되므로 별도 상태 토글이 불필요.
 */
function ResolveAction({
  eventId,
  resolved,
  bookingUrl,
  onResolved,
}: {
  eventId: string | null;
  resolved: boolean;
  bookingUrl: string | null;
  onResolved: () => void;
}) {
  const [url, setUrl] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  if (resolved) {
    return bookingUrl ? (
      <a
        href={bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-caption text-primary underline underline-offset-2"
      >
        예매 링크 ↗
      </a>
    ) : (
      <span className="text-caption text-text-tertiary">-</span>
    );
  }

  if (!eventId) {
    return <span className="text-caption text-text-tertiary">공연 없음</span>;
  }

  const save = async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.error("http(s):// 로 시작하는 URL 을 입력하세요");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_url: trimmed }),
      });
      if (!res.ok) throw new Error("연결 실패");
      toast.success("예매 링크를 연결했어요");
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "연결 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        placeholder="예매 URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="h-8 w-[200px] text-caption"
      />
      <Button size="sm" onClick={() => void save()} loading={saving}>
        연결
      </Button>
    </div>
  );
}

export function BookingIssuesPageClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<AdminPageSize>(
    DEFAULT_ADMIN_PAGE_SIZE,
  );

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery<IssuesResponse>({
    queryKey: [
      "admin-booking-issues",
      { q: debouncedSearch, filter, page, pageSize },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        filter,
      });
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(`/api/admin/booking-issues?${params}`);
      if (!res.ok) throw new Error("fetch failed");
      return res.json() as Promise<IssuesResponse>;
    },
  });

  const rows = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="공연명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="md:max-w-sm"
        />
        <Select
          value={filter}
          onValueChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="md:w-[200px]">
            <SelectValue placeholder="필터" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="unresolved">미해결(링크 여전히 없음)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-muted/40 py-12 text-center">
          <p className="text-body text-text-secondary">
            기록된 예매 링크 이슈가 없습니다.
          </p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>공연명</TableHead>
                <TableHead>사유</TableHead>
                <TableHead>플랫폼</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>발생 시각</TableHead>
                <TableHead>예매 링크 연결</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.events?.title ?? row.event_title ?? "-"}
                  </TableCell>
                  <TableCell>
                    {row.reason === "missing_booking_url"
                      ? "예매 링크 미연결"
                      : row.reason}
                  </TableCell>
                  <TableCell>{row.platform}</TableCell>
                  <TableCell>
                    <Badge variant={row.resolved ? "success" : "warning"}>
                      {row.resolved ? "해결됨" : "미해결"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatKst(row.created_at)}</TableCell>
                  <TableCell>
                    <ResolveAction
                      eventId={row.event_id}
                      resolved={row.resolved}
                      bookingUrl={row.events?.booking_url ?? null}
                      onResolved={() =>
                        void queryClient.invalidateQueries({
                          queryKey: ["admin-booking-issues"],
                        })
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {meta && (
            <AdminListPagination
              page={meta.page}
              pageSize={pageSize}
              totalPages={meta.totalPages}
              total={meta.total}
              rowCountOnPage={rows.length}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
