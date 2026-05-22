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

interface BookingRow {
  id: string;
  seat: string | null;
  delivery_type: string | null;
  booked_at: string;
  status: "active" | "cancelled";
  events: {
    id: string;
    title: string;
    start_date: string;
    end_date: string | null;
    venues: { name: string } | null;
  } | null;
}

interface BookingsResponse {
  data: BookingRow[];
  meta: PaginationMeta;
}

export function BookingsPageClient() {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
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

  const queryKey = [
    "admin-bookings",
    { q: debouncedSearch, status: statusFilter, page, pageSize },
  ];

  const { data, isLoading } = useQuery<BookingsResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status: statusFilter,
      });
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(`/api/admin/bookings?${params}`);
      if (!res.ok) throw new Error("fetch failed");
      return res.json() as Promise<BookingsResponse>;
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
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="md:w-[180px]">
            <SelectValue placeholder="상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            <SelectItem value="active">예매 완료</SelectItem>
            <SelectItem value="cancelled">취소</SelectItem>
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
            표시할 예매가 없습니다.
          </p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>공연명</TableHead>
                <TableHead>공연장</TableHead>
                <TableHead>좌석</TableHead>
                <TableHead>배송방식</TableHead>
                <TableHead>예매일</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.events?.title ?? "-"}
                  </TableCell>
                  <TableCell>{row.events?.venues?.name ?? "-"}</TableCell>
                  <TableCell>{row.seat ?? "-"}</TableCell>
                  <TableCell>{row.delivery_type ?? "-"}</TableCell>
                  <TableCell>{formatKst(row.booked_at)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={row.status === "active" ? "success" : "outline"}
                    >
                      {row.status === "active" ? "예매 완료" : "취소"}
                    </Badge>
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
