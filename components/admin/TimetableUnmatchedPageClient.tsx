"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

interface UnmatchedRow {
  id: string;
  event_id: string | null;
  event_title: string | null;
  artist_name: string;
  stage_name: string | null;
  day_number: number | null;
  source: string;
  is_resolved: boolean;
  created_at: string;
  events: { id: string; title: string } | null;
}

interface UnmatchedResponse {
  data: UnmatchedRow[];
  meta: PaginationMeta;
}

const SOURCE_LABELS: Record<string, string> = {
  image: "캡쳐 이미지",
  text: "텍스트",
  auto: "자동(StagePick)",
  manual: "수동",
};

export function TimetableUnmatchedPageClient() {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [status, setStatus] = React.useState("unresolved");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<AdminPageSize>(
    DEFAULT_ADMIN_PAGE_SIZE,
  );
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery<UnmatchedResponse>({
    queryKey: [
      "admin-timetable-unmatched",
      { q: debouncedSearch, status, page, pageSize },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status,
      });
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(`/api/admin/timetable/unmatched?${params}`);
      if (!res.ok) throw new Error("fetch failed");
      return res.json() as Promise<UnmatchedResponse>;
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (vars: { id: string; is_resolved: boolean }) => {
      const res = await fetch("/api/admin/timetable/unmatched", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      if (!res.ok) throw new Error("update failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin-timetable-unmatched"],
      });
    },
  });

  const rows = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="아티스트명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="md:max-w-sm"
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="md:w-[160px]">
            <SelectValue placeholder="상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unresolved">미해결</SelectItem>
            <SelectItem value="all">전체</SelectItem>
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
            미매칭 아티스트 로그가 없습니다.
          </p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>아티스트명</TableHead>
                <TableHead>공연</TableHead>
                <TableHead>스테이지</TableHead>
                <TableHead>출처</TableHead>
                <TableHead>발생 시각</TableHead>
                <TableHead>처리</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.artist_name}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {row.events?.title ?? row.event_title ?? "-"}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {row.stage_name || "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {SOURCE_LABELS[row.source] ?? row.source}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatKst(row.created_at)}</TableCell>
                  <TableCell>
                    <Button
                      variant={row.is_resolved ? "outline" : "default"}
                      size="sm"
                      disabled={resolveMutation.isPending}
                      onClick={() =>
                        resolveMutation.mutate({
                          id: row.id,
                          is_resolved: !row.is_resolved,
                        })
                      }
                    >
                      {row.is_resolved ? "미해결로" : "해결됨"}
                    </Button>
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
