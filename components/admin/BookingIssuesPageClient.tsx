"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/Badge";
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

export function BookingIssuesPageClient() {
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
