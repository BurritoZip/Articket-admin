"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

interface ErrorRow {
  id: string;
  platform: string;
  error_type: string;
  message: string;
  domain: string | null;
  stack_trace: string | null;
  context: Record<string, unknown> | null;
  app_version: string | null;
  os_version: string | null;
  device_model: string | null;
  app_user_id: string | null;
  is_resolved: boolean;
  created_at: string;
}

interface ErrorsResponse {
  data: ErrorRow[];
  meta: PaginationMeta;
}

const TYPE_LABELS: Record<string, string> = {
  crash: "크래시",
  network: "네트워크",
  decoding: "디코딩",
  http: "HTTP",
  runtime: "런타임",
};

function typeBadgeVariant(type: string): "danger" | "warning" | "default" {
  if (type === "crash") return "danger";
  if (type === "http" || type === "network") return "warning";
  return "default";
}

export function ErrorLogsPageClient() {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [type, setType] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<AdminPageSize>(
    DEFAULT_ADMIN_PAGE_SIZE,
  );
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError } = useQuery<ErrorsResponse>({
    queryKey: [
      "admin-error-logs",
      { q: debouncedSearch, type, status, page, pageSize },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status,
      });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (type !== "all") params.set("type", type);
      const res = await fetch(`/api/admin/error-logs?${params}`);
      if (!res.ok) throw new Error("fetch failed");
      return res.json() as Promise<ErrorsResponse>;
    },
    refetchInterval: 15000, // 새 에러 자동 반영
  });

  const resolveMutation = useMutation({
    mutationFn: async (vars: { id: string; is_resolved: boolean }) => {
      const res = await fetch("/api/admin/error-logs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      if (!res.ok) throw new Error("update failed");
      return res.json();
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["admin-error-logs"] });
      queryClient.invalidateQueries({ queryKey: ["admin-attention-counts"] });
      toast.success(vars.is_resolved ? "해결됨으로 표시" : "미해결로 되돌림");
    },
    onError: () => toast.error("상태 변경 실패 — 다시 시도하세요."),
  });

  const rows = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-4">
      {meta && (
        <p className="text-body-sm text-text-secondary">
          {status === "unresolved" ? "미해결 " : "총 "}
          <span className="font-semibold text-text-primary">{meta.total}</span>
          건
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="에러 메시지 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="md:max-w-sm"
        />
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="md:w-[160px]">
            <SelectValue placeholder="유형" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 유형</SelectItem>
            <SelectItem value="crash">크래시</SelectItem>
            <SelectItem value="network">네트워크</SelectItem>
            <SelectItem value="decoding">디코딩</SelectItem>
            <SelectItem value="http">HTTP</SelectItem>
            <SelectItem value="runtime">런타임</SelectItem>
          </SelectContent>
        </Select>
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
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="unresolved">미해결</SelectItem>
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
            에러 로그를 불러오지 못했습니다. 잠시 후 다시 시도하세요.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-muted/40 py-12 text-center">
          <p className="text-body text-text-secondary">
            기록된 앱 에러 로그가 없습니다.
          </p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>유형</TableHead>
                <TableHead>메시지</TableHead>
                <TableHead>위치</TableHead>
                <TableHead>환경</TableHead>
                <TableHead>발생 시각</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <React.Fragment key={row.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() =>
                      setExpanded(expanded === row.id ? null : row.id)
                    }
                  >
                    <TableCell>
                      <Badge variant={typeBadgeVariant(row.error_type)}>
                        {TYPE_LABELS[row.error_type] ?? row.error_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate font-medium">
                      {row.message}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {row.domain ?? "-"}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {[row.platform, row.os_version, row.app_version]
                        .filter(Boolean)
                        .join(" · ") || "-"}
                    </TableCell>
                    <TableCell>{formatKst(row.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={row.is_resolved ? "success" : "warning"}>
                        {row.is_resolved ? "해결됨" : "미해결"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {expanded === row.id && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-surface-muted/40">
                        <div className="space-y-3 py-2 text-body-sm">
                          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                            <Meta label="플랫폼" value={row.platform} />
                            <Meta label="OS" value={row.os_version} />
                            <Meta label="앱 버전" value={row.app_version} />
                            <Meta label="기기" value={row.device_model} />
                            <Meta label="사용자" value={row.app_user_id} />
                          </div>
                          {row.stack_trace && (
                            <div>
                              <p className="mb-1 font-medium text-text-secondary">
                                스택 트레이스
                              </p>
                              <pre className="max-h-64 overflow-auto rounded-md bg-surface p-3 text-caption">
                                {row.stack_trace}
                              </pre>
                            </div>
                          )}
                          {row.context && (
                            <div>
                              <p className="mb-1 font-medium text-text-secondary">
                                컨텍스트
                              </p>
                              <pre className="max-h-48 overflow-auto rounded-md bg-surface p-3 text-caption">
                                {JSON.stringify(row.context, null, 2)}
                              </pre>
                            </div>
                          )}
                          <Button
                            variant={row.is_resolved ? "outline" : "default"}
                            size="sm"
                            disabled={resolveMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              resolveMutation.mutate({
                                id: row.id,
                                is_resolved: !row.is_resolved,
                              });
                            }}
                          >
                            {row.is_resolved
                              ? "미해결로 되돌리기"
                              : "해결됨으로 표시"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
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

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <span className="text-text-tertiary">{label}: </span>
      <span className="text-text-secondary">{value ?? "-"}</span>
    </div>
  );
}
