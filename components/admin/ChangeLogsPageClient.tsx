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

interface ChangeRow {
  id: string;
  event_id: string | null;
  event_title: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

interface ChangeResponse {
  data: ChangeRow[];
  meta: PaginationMeta;
}

const FIELD_LABELS: Record<string, string> = {
  start_date: "시작일",
  end_date: "종료일",
  status: "상태",
  genre: "장르",
  artist_id: "아티스트",
  poster_url: "표지",
  ticket_provider: "예매처",
  ticket_open_date: "예매오픈",
  ticket_close_date: "예매마감",
  venue_id: "공연장",
  age_restriction: "관람연령",
  booking_url: "예매링크",
  notice_text: "설명",
};

function short(v: string | null): string {
  if (v == null || v === "") return "∅";
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

export function ChangeLogsPageClient() {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [field, setField] = React.useState("all");
  const [hideNoop, setHideNoop] = React.useState(true);
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

  const { data, isLoading, isError } = useQuery<ChangeResponse>({
    queryKey: [
      "admin-change-logs",
      { q: debouncedSearch, field, hideNoop, page, pageSize },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (field !== "all") params.set("field", field);
      if (hideNoop) params.set("hideNoop", "1");
      const res = await fetch(`/api/admin/change-logs?${params}`);
      if (!res.ok) throw new Error("fetch failed");
      return res.json() as Promise<ChangeResponse>;
    },
    refetchInterval: 30000,
  });

  const rows = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-4">
      {meta && (
        <p className="text-body-sm text-text-secondary">
          최근 변경{" "}
          <span className="font-semibold text-text-primary">{meta.total}</span>건
          (필드/공연 필터 적용 가능)
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="공연명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="md:max-w-sm"
        />
        <Select
          value={field}
          onValueChange={(v) => {
            setField(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="md:w-[180px]">
            <SelectValue placeholder="필드" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 필드</SelectItem>
            {Object.entries(FIELD_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={hideNoop ? "hide" : "show"}
          onValueChange={(v) => {
            setHideNoop(v === "hide");
            setPage(1);
          }}
        >
          <SelectTrigger className="md:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hide">실제 변경만 (포맷차이 숨김)</SelectItem>
            <SelectItem value="show">전체 (포맷차이 포함)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-danger/40 bg-danger-weak/30 py-12 text-center">
          <p className="text-body text-danger">
            변경 내역을 불러오지 못했습니다. 잠시 후 다시 시도하세요.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-muted/40 py-12 text-center">
          <p className="text-body text-text-secondary">
            표시할 변경 내역이 없습니다.
          </p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>공연명</TableHead>
                <TableHead>필드</TableHead>
                <TableHead>변경 내용</TableHead>
                <TableHead>시각</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-xs truncate font-medium">
                    {row.event_title ?? "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {FIELD_LABELS[row.field_name] ?? row.field_name}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-caption">
                    <span className="text-text-tertiary">
                      {short(row.old_value)}
                    </span>
                    <span className="mx-1.5 text-text-secondary">→</span>
                    <span className="text-text-primary">
                      {short(row.new_value)}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatKst(row.changed_at)}
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
