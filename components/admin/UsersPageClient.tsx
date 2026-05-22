"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/AlertDialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { formatKst } from "@/lib/format-kst";
import { cn } from "@/lib/utils";
import type { AdminUserRow } from "@/types/admin-user";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import {
  DEFAULT_ADMIN_PAGE_SIZE,
  type AdminPageSize,
} from "@/lib/admin-pagination";

function statusBadge(status: AdminUserRow["accountStatus"]) {
  const label =
    status === "active" ? "활성" : status === "pending" ? "승인 대기" : "정지";
  const variant =
    status === "active"
      ? "success"
      : status === "pending"
        ? "warning"
        : "danger";
  return (
    <Badge variant={variant} className="gap-1">
      <span className="sr-only">상태:</span>
      {label}
    </Badge>
  );
}

function exportCsv(rows: AdminUserRow[]) {
  const header = [
    "id",
    "displayName",
    "email",
    "role",
    "lastVisitDate",
    "bookingCount",
    "followingCount",
    "createdAt",
    "accountStatus",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.id,
        `"${r.displayName.replace(/"/g, '""')}"`,
        r.email,
        r.role,
        r.lastVisitDate ?? "",
        r.bookingCount,
        r.followingCount,
        r.createdAt,
        r.accountStatus,
      ].join(","),
    ),
  ];
  const blob = new Blob(["﻿" + lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `articket-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function UsersPageClient() {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<AdminPageSize>(DEFAULT_ADMIN_PAGE_SIZE);

  const [sheetUser, setSheetUser] = React.useState<AdminUserRow | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editAdmin, setEditAdmin] = React.useState(false);

  const [addOpen, setAddOpen] = React.useState(false);
  const [addForm, setAddForm] = React.useState({
    displayName: "",
    email: "",
    role: "user" as "user" | "admin",
  });
  const [addLoading, setAddLoading] = React.useState(false);

  const [deleteTarget, setDeleteTarget] = React.useState<AdminUserRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    setPage(1);
    setRowSelection({});
  }, [statusFilter]);

  const {
    data: usersPayload,
    isLoading: loading,
    error: usersError,
  } = useQuery({
    queryKey: ["admin-users", page, pageSize, debouncedSearch],
    queryFn: async () => {
      const q = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch) q.set("q", debouncedSearch);
      const res = await fetch(`/api/admin/users?${q}`, { cache: "no-store" });
      if (!res.ok) {
        const err = (await res.json()) as { detail?: string; error?: string };
        throw new Error(err.detail ?? err.error ?? "사용자 목록을 불러오지 못했습니다.");
      }
      const json = (await res.json()) as {
        rows: AdminUserRow[];
        total?: number;
        totalPages?: number;
        warning?: string;
      };
      if (json.warning) {
        toast.message("사용자 목록 제한 모드", { description: json.warning });
      }
      return {
        rows: json.rows ?? [],
        total: json.total ?? 0,
        totalPages: json.totalPages ?? 1,
      };
    },
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-user-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users/stats", { cache: "no-store" });
      if (!res.ok) {
        const err = (await res.json()) as { detail?: string };
        throw new Error(err.detail ?? "지표를 불러오지 못했습니다.");
      }
      return (await res.json()) as {
        totalUsers: number;
        pending: number;
        suspended: number;
        recent: number;
      };
    },
    staleTime: 60_000,
  });

  const pageUserRows = React.useMemo(() => usersPayload?.rows ?? [], [usersPayload?.rows]);
  const listTotal = usersPayload?.total ?? 0;
  const listTotalPages = usersPayload?.totalPages ?? 1;

  const filteredData = React.useMemo(() => {
    if (statusFilter === "all") return pageUserRows;
    return pageUserRows.filter((u) => u.accountStatus === statusFilter);
  }, [pageUserRows, statusFilter]);

  const invalidateUserQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-user-stats"] });
  };

  React.useEffect(() => {
    setRowSelection({});
  }, [page, pageSize]);

  React.useEffect(() => {
    if (!usersError) return;
    toast.error("사용자 목록 조회 실패", {
      description:
        usersError instanceof Error ? usersError.message : "알 수 없는 오류",
    });
  }, [usersError]);

  React.useEffect(() => {
    if (sheetUser) {
      setEditName(sheetUser.displayName);
      setEditAdmin(sheetUser.role === "admin");
    }
  }, [sheetUser]);

  const metrics = {
    total: stats?.totalUsers ?? 0,
    pending: stats?.pending ?? 0,
    suspended: stats?.suspended ?? 0,
    recent: stats?.recent ?? 0,
  };

  const columns = React.useMemo<ColumnDef<AdminUserRow>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label="전체 선택"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            aria-label={`${row.original.displayName} 선택`}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "displayName",
        header: "표시 이름",
        cell: ({ row }) => (
          <span className="font-medium text-text-primary">
            {row.original.displayName}
          </span>
        ),
      },
      {
        accessorKey: "email",
        header: "이메일",
      },
      {
        accessorKey: "role",
        header: "역할",
        cell: ({ row }) => (
          <Badge variant={row.original.role === "admin" ? "default" : "outline"}>
            {row.original.role === "admin" ? "관리자" : "사용자"}
          </Badge>
        ),
      },
      {
        accessorKey: "accountStatus",
        header: "상태",
        cell: ({ row }) => statusBadge(row.original.accountStatus),
      },
      {
        accessorKey: "bookingCount",
        header: "예매",
      },
      {
        accessorKey: "followingCount",
        header: "팔로잉",
      },
      {
        accessorKey: "lastVisitDate",
        header: "최근 방문",
        cell: ({ row }) => (
          <span className="text-text-secondary">
            {formatKst(row.original.lastVisitDate)}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "가입일",
        cell: ({ row }) => (
          <span className="text-text-secondary">
            {formatKst(row.original.createdAt, false)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "작업",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => setSheetUser(row.original)}
            >
              상세
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="더보기">
                  <MoreHorizontal className="h-5 w-5" strokeWidth={1.6} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>행 작업</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSheetUser(row.original)}>
                  프로필 편집
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setDeleteTarget(row.original);
                    setDeleteConfirm("");
                  }}
                  className="text-danger focus:text-danger"
                >
                  계정 삭제…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const selectedRows = table.getFilteredSelectedRowModel().rows;
  const selectedUsers = selectedRows.map((r) => r.original);

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "사용자" },
        ]}
        title="사용자 관리"
        description="가입자 프로필·권한·활동을 한 화면에서 점검하고, 승인 대기·정지 계정을 빠르게 처리합니다."
        action={
          <Button type="button" onClick={() => setAddOpen(true)}>
            <Plus className="h-5 w-5" strokeWidth={1.6} aria-hidden />
            사용자 추가
          </Button>
        }
      />

      {/* 요약 지표 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "전체 사용자", value: metrics.total },
          { label: "승인 대기", value: metrics.pending, warn: metrics.pending > 0 },
          { label: "정지 계정", value: metrics.suspended },
          { label: "최근 7일 활동", value: metrics.recent },
        ].map((card) => (
          <Card
            key={card.label}
            className={cn(
              card.warn && "border-warning/40 bg-warning-weak/30 dark:bg-warning-weak/10",
            )}
          >
            <CardHeader className="pb-2">
              <p className="text-body-sm font-medium text-text-secondary">
                {card.label}
              </p>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-10 w-24" />
              ) : (
                <p className="text-display tabular-nums text-text-primary">
                  {card.value}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-h3">사용자 목록</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Input
              placeholder="이름 검색 (서버 검색)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 min-w-[200px] flex-1 lg:max-w-sm"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-10 w-full sm:w-[180px]">
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="active">활성</SelectItem>
                <SelectItem value="pending">승인 대기</SelectItem>
                <SelectItem value="suspended">정지</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 lg:ml-auto">
              <Button
                variant="outline"
                type="button"
                disabled={selectedUsers.length === 0}
                onClick={() => {
                  exportCsv(selectedUsers);
                  toast.success("내보내기 완료", {
                    description: `${selectedUsers.length}명 CSV 저장`,
                  });
                }}
              >
                선택 CSV 내보내기 ({selectedUsers.length})
              </Button>
            </div>
          </div>
          {statusFilter !== "all" && (
            <p className="text-caption text-text-tertiary">
              상태 필터는 현재 페이지 데이터 기준입니다. 전체 검색은 이름 검색창을 이용하세요.
            </p>
          )}

          {loading ? (
            <div className="space-y-2" aria-busy>
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : filteredData.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted/40 py-16 text-center">
              <p className="text-body font-medium text-text-primary">
                조건에 맞는 사용자가 없습니다.
              </p>
              {(search || statusFilter !== "all") && (
                <Button
                  className="mt-6"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                  }}
                >
                  필터 초기화
                </Button>
              )}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((hg) => (
                    <TableRow key={hg.id}>
                      {hg.headers.map((header) => (
                        <TableHead key={header.id}>
                          {header.isPlaceholder ? null : (
                            <button
                              type="button"
                              className={cn(
                                "inline-flex items-center gap-1 rounded-sm font-semibold text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                header.column.getCanSort() &&
                                  "cursor-pointer select-none hover:text-text-primary",
                              )}
                              onClick={header.column.getToggleSortingHandler()}
                              disabled={!header.column.getCanSort()}
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                              {header.column.getCanSort() ? (
                                header.column.getIsSorted() === "desc" ? (
                                  <ArrowDown className="h-4 w-4" aria-hidden />
                                ) : header.column.getIsSorted() === "asc" ? (
                                  <ArrowUp className="h-4 w-4" aria-hidden />
                                ) : (
                                  <ArrowUpDown className="h-4 w-4 opacity-50" aria-hidden />
                                )
                              ) : null}
                            </button>
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() ? "selected" : undefined}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <AdminListPagination
                page={page}
                totalPages={listTotalPages}
                pageSize={pageSize}
                total={listTotal}
                rowCountOnPage={filteredData.length}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* 사용자 초대 다이얼로그 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>사용자 초대</DialogTitle>
            <DialogDescription>
              이메일로 초대 링크를 발송합니다. Supabase Auth와 연동됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="add-name">표시 이름</Label>
              <Input
                id="add-name"
                value={addForm.displayName}
                onChange={(e) => setAddForm((s) => ({ ...s, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-email">
                이메일 <span className="text-red-500">*</span>
              </Label>
              <Input
                id="add-email"
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((s) => ({ ...s, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>역할</Label>
              <Select
                value={addForm.role}
                onValueChange={(v: "user" | "admin") =>
                  setAddForm((s) => ({ ...s, role: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">사용자</SelectItem>
                  <SelectItem value="admin">관리자</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setAddOpen(false)}>
              취소
            </Button>
            <Button
              type="button"
              loading={addLoading}
              onClick={async () => {
                if (!addForm.email.trim()) {
                  toast.error("이메일을 입력하세요.");
                  return;
                }
                setAddLoading(true);
                try {
                  const res = await fetch("/api/admin/users", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      email: addForm.email.trim(),
                      displayName: addForm.displayName.trim(),
                      role: addForm.role,
                    }),
                  });
                  if (!res.ok) {
                    const errorJson = (await res.json()) as { detail?: string };
                    throw new Error(errorJson.detail ?? "초대 생성 실패");
                  }
                  invalidateUserQueries();
                  setAddOpen(false);
                  toast.success("초대 발송 완료", {
                    description: `${addForm.email}로 초대 메일을 보냈습니다.`,
                  });
                  setAddForm({ displayName: "", email: "", role: "user" });
                } catch (error) {
                  toast.error("초대 실패", {
                    description:
                      error instanceof Error ? error.message : "알 수 없는 오류",
                  });
                } finally {
                  setAddLoading(false);
                }
              }}
            >
              초대 보내기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 사용자 상세/편집 시트 */}
      <Sheet open={!!sheetUser} onOpenChange={(o) => !o && setSheetUser(null)}>
        <SheetContent className="flex w-full flex-col sm:max-w-lg">
          {sheetUser ? (
            <>
              <SheetHeader>
                <SheetTitle>사용자 상세</SheetTitle>
                <SheetDescription>
                  {sheetUser.email} · 가입{" "}
                  {formatKst(sheetUser.createdAt, false)}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-1 flex-col gap-6 overflow-y-auto py-4">
                <div className="space-y-2">
                  <Label htmlFor="detail-name">표시 이름</Label>
                  <Input
                    id="detail-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                  <div>
                    <p className="text-body-sm font-medium text-text-primary">
                      관리자 권한
                    </p>
                    <p className="text-caption text-text-tertiary">
                      켜면 이 계정으로 운영 콘솔 전역에 접근할 수 있습니다.
                    </p>
                  </div>
                  <Switch
                    checked={editAdmin}
                    onCheckedChange={setEditAdmin}
                    aria-label="관리자 권한 토글"
                  />
                </div>
                {/* 실제 집계 데이터 */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border p-3 text-center">
                    <p className="text-caption text-text-tertiary">예매</p>
                    <p className="mt-1 text-xl font-bold">{sheetUser.bookingCount}</p>
                  </div>
                  <div className="rounded-md border border-border p-3 text-center">
                    <p className="text-caption text-text-tertiary">팔로잉</p>
                    <p className="mt-1 text-xl font-bold">{sheetUser.followingCount}</p>
                  </div>
                </div>
                <div className="rounded-md border border-border bg-surface-muted/30 p-3 text-body-sm text-text-secondary">
                  예매·팔로우 상세 내역은 예매 관리 페이지에서 해당 사용자로 검색하세요.
                </div>
              </div>
              <SheetFooter className="gap-2 border-t border-border pt-4 sm:justify-between">
                <Button
                  type="button"
                  variant="danger-weak"
                  onClick={() => {
                    setDeleteTarget(sheetUser);
                    setDeleteConfirm("");
                  }}
                >
                  계정 삭제…
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSheetUser(null)}
                  >
                    닫기
                  </Button>
                  <Button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/admin/users/${sheetUser.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            displayName: editName,
                            role: editAdmin ? "admin" : "user",
                          }),
                        });
                        if (!res.ok) {
                          const errorJson = (await res.json()) as { detail?: string };
                          throw new Error(errorJson.detail ?? "저장 실패");
                        }
                        invalidateUserQueries();
                        toast.success("프로필이 저장되었습니다.");
                        setSheetUser(null);
                      } catch (error) {
                        toast.error("저장 실패", {
                          description:
                            error instanceof Error ? error.message : "알 수 없는 오류",
                        });
                      }
                    }}
                  >
                    변경 저장
                  </Button>
                </div>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* 계정 삭제 확인 */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>계정을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              이 작업은 되돌릴 수 없습니다. 계속하려면 아래에{" "}
              <strong className="text-text-primary">삭제</strong>를 입력하세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="삭제"
            aria-label="삭제 확인 입력"
          />
          <AlertDialogFooter>
            <AlertDialogCancel type="button">취소</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-danger text-danger-foreground hover:opacity-90"
              disabled={deleteConfirm !== "삭제"}
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  const res = await fetch(`/api/admin/users/${deleteTarget.id}`, {
                    method: "DELETE",
                  });
                  if (!res.ok) {
                    const errorJson = (await res.json()) as { detail?: string };
                    throw new Error(errorJson.detail ?? "삭제 실패");
                  }
                  invalidateUserQueries();
                  toast.success("계정이 삭제되었습니다.");
                  setDeleteTarget(null);
                  setSheetUser(null);
                } catch (error) {
                  toast.error("삭제 실패", {
                    description:
                      error instanceof Error ? error.message : "알 수 없는 오류",
                  });
                }
              }}
            >
              삭제 실행
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
