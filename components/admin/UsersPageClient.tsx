"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Filter,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
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
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
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
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [rowSelection, setRowSelection] = React.useState<
    Record<string, boolean>
  >({});

  const [sheetUser, setSheetUser] = React.useState<AdminUserRow | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editAdmin, setEditAdmin] = React.useState(false);

  const [addOpen, setAddOpen] = React.useState(false);
  const [addForm, setAddForm] = React.useState({
    displayName: "",
    email: "",
    role: "user" as "user" | "admin",
    note: "",
    phone: "",
  });
  const [addLoading, setAddLoading] = React.useState(false);

  const [deleteTarget, setDeleteTarget] = React.useState<AdminUserRow | null>(
    null,
  );
  const [deleteConfirm, setDeleteConfirm] = React.useState("");

  const {
    data: userRows = [],
    isLoading: loading,
    error: usersError,
    refetch,
  } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) {
        const err = (await res.json()) as { detail?: string; error?: string };
        throw new Error(
          err.detail ?? err.error ?? "사용자 목록을 불러오지 못했습니다.",
        );
      }
      const json = (await res.json()) as { rows: AdminUserRow[] };
      if (
        "warning" in json &&
        typeof (json as { warning?: string }).warning === "string"
      ) {
        const warning = (json as { warning: string }).warning;
        toast.message("사용자 목록 제한 모드", { description: warning });
      }
      return json.rows;
    },
  });
  const data = userRows;

  React.useEffect(() => {
    if (!usersError) return;
    toast.error("사용자 목록 조회 실패", {
      description:
        usersError instanceof Error
          ? usersError.message
          : "알 수 없는 오류가 발생했습니다.",
    });
  }, [usersError]);

  React.useEffect(() => {
    if (sheetUser) {
      setEditName(sheetUser.displayName);
      setEditAdmin(sheetUser.role === "admin");
    }
  }, [sheetUser]);

  const filteredData = React.useMemo(() => {
    return data.filter((u) => {
      if (statusFilter !== "all" && u.accountStatus !== statusFilter)
        return false;
      return true;
    });
  }, [data, statusFilter]);

  const metrics = React.useMemo(() => {
    const total = data.length;
    const pending = data.filter((u) => u.accountStatus === "pending").length;
    const suspended = data.filter(
      (u) => u.accountStatus === "suspended",
    ).length;
    const recent = data.filter((u) => {
      if (!u.lastVisitDate) return false;
      const d = new Date(u.lastVisitDate);
      return Date.now() - d.getTime() < 7 * 86400000;
    }).length;
    return { total, pending, suspended, recent };
  }, [data]);

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
          <Badge
            variant={row.original.role === "admin" ? "default" : "outline"}
          >
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
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 5 } },
    globalFilterFn: (row, _id, filter) => {
      const q = String(filter).toLowerCase();
      const u = row.original;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    },
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

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="sr-only">
          요약 지표
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="전체 사용자"
            value={metrics.total}
            delta="+2.4%"
            deltaPositive
            badge="실시간"
            loading={loading}
          />
          <MetricCard
            label="승인 대기"
            value={metrics.pending}
            delta="처리 필요"
            badge="주의"
            loading={loading}
            emphasize
          />
          <MetricCard
            label="정지·이상 계정"
            value={metrics.suspended}
            delta="주간 기준"
            loading={loading}
          />
          <MetricCard
            label="최근 7일 활동"
            value={metrics.recent}
            delta="+12명"
            deltaPositive
            loading={loading}
          />
        </div>
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-h3">사용자 목록</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div
            className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center"
            role="toolbar"
            aria-label="목록 도구"
          >
            <div className="min-w-[200px] flex-1 lg:max-w-sm">
              <label className="relative block">
                <span className="sr-only">이름 또는 이메일 검색</span>
                <Input
                  placeholder="이름 또는 이메일 검색…"
                  value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  className="h-11"
                />
              </label>
            </div>
            <Button variant="outline" type="button" className="gap-2">
              <Filter className="h-5 w-5" strokeWidth={1.6} aria-hidden />
              필터
            </Button>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-11 w-full sm:w-[180px]">
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="active">활성</SelectItem>
                <SelectItem value="pending">승인 대기</SelectItem>
                <SelectItem value="suspended">정지</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2 lg:ml-auto">
              <Input
                type="date"
                className="h-11 w-[160px]"
                aria-label="시작일"
              />
              <Input
                type="date"
                className="h-11 w-[160px]"
                aria-label="종료일"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" type="button" className="gap-2">
                  <SlidersHorizontal
                    className="h-5 w-5"
                    strokeWidth={1.6}
                    aria-hidden
                  />
                  정렬
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>정렬 기준</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setSorting([{ id: "createdAt", desc: true }])}
                >
                  가입일 최신순
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setSorting([{ id: "displayName", desc: false }])
                  }
                >
                  이름 가나다순
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  type="button"
                  disabled={selectedUsers.length === 0}
                >
                  일괄 작업 ({selectedUsers.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    exportCsv(selectedUsers);
                    toast.success("내보내기 완료", {
                      description: `${selectedUsers.length}명 CSV 저장`,
                    });
                  }}
                >
                  선택 항목 CSV 내보내기
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    toast.message("데모", {
                      description: "실제 환경에서 일괄 메일 발송",
                    })
                  }
                >
                  선택 항목 메일 발송
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {loading ? (
            <div className="space-y-2" aria-busy>
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : filteredData.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted/40 py-16 text-center"
              role="status"
            >
              <p className="text-body font-medium text-text-primary">
                표시할 사용자가 없습니다.
              </p>
              <p className="mt-2 max-w-md text-body-sm text-text-secondary">
                검색어나 상태 필터를 조정하거나 새 사용자를 추가해 보세요.
              </p>
              <Button
                className="mt-6"
                type="button"
                onClick={() => {
                  setGlobalFilter("");
                  setStatusFilter("all");
                }}
              >
                필터 초기화
              </Button>
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
                                  <ArrowUpDown
                                    className="h-4 w-4 opacity-50"
                                    aria-hidden
                                  />
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
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-caption text-text-tertiary">
                  {table.getFilteredRowModel().rows.length}명 중{" "}
                  {selectedRows.length}명 선택
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  >
                    이전
                  </Button>
                  <span className="text-body-sm text-text-secondary">
                    {table.getState().pagination.pageIndex + 1} /{" "}
                    {table.getPageCount()}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  >
                    다음
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <section
        className="rounded-xl border border-border bg-surface p-6 shadow-elevation1"
        aria-labelledby="ui-states-heading"
      >
        <h2 id="ui-states-heading" className="text-h3 text-text-primary">
          컴포넌트 상태 (디자인 검증)
        </h2>
        <p className="mt-2 text-body-sm text-text-secondary">
          버튼·입력·뱃지·토스트 등 주요 상호작용 상태를 한눈에 확인합니다.
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-caption font-semibold text-text-tertiary">
              버튼
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button">주요</Button>
              <Button type="button" variant="secondary">
                보조
              </Button>
              <Button type="button" variant="outline">
                테두리
              </Button>
              <Button type="button" disabled>
                비활성
              </Button>
              <Button type="button" loading>
                로딩
              </Button>
              <Button type="button" variant="danger">
                위험
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-caption font-semibold text-text-tertiary">
              입력 · 뱃지
            </p>
            <Input placeholder="기본 입력" />
            <Input placeholder="오류 상태" error aria-invalid />
            <div className="flex flex-wrap gap-2">
              <Badge>기본</Badge>
              <Badge variant="success">완료</Badge>
              <Badge variant="warning">주의</Badge>
              <Badge variant="danger">실패</Badge>
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              toast.success("저장되었습니다", {
                description: "변경 사항이 반영되었습니다.",
              })
            }
          >
            성공 토스트
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              toast.error("처리 실패", {
                description: "네트워크를 확인한 뒤 다시 시도하세요.",
              })
            }
          >
            오류 토스트
          </Button>
        </div>
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>사용자 초대</DialogTitle>
            <DialogDescription>
              최대 5개 필드로 빠르게 초대 정보를 입력합니다. 실제 환경에서는
              Supabase Auth와 연동됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="add-name">표시 이름</Label>
              <Input
                id="add-name"
                value={addForm.displayName}
                onChange={(e) =>
                  setAddForm((s) => ({ ...s, displayName: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-email">이메일</Label>
              <Input
                id="add-email"
                type="email"
                value={addForm.email}
                onChange={(e) =>
                  setAddForm((s) => ({ ...s, email: e.target.value }))
                }
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
            <div className="space-y-2">
              <Label htmlFor="add-note">초대 메모</Label>
              <Input
                id="add-note"
                value={addForm.note}
                onChange={(e) =>
                  setAddForm((s) => ({ ...s, note: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-phone">휴대폰 (선택)</Label>
              <Input
                id="add-phone"
                value={addForm.phone}
                onChange={(e) =>
                  setAddForm((s) => ({ ...s, phone: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => setAddOpen(false)}
            >
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
                  await refetch();
                  setAddOpen(false);
                  toast.success("초대 생성됨", {
                    description: `${addForm.email} 로 초대 메일을 보냈습니다.`,
                  });
                  setAddForm({
                    displayName: "",
                    email: "",
                    role: "user",
                    note: "",
                    phone: "",
                  });
                } catch (error) {
                  toast.error("초대 실패", {
                    description:
                      error instanceof Error
                        ? error.message
                        : "알 수 없는 오류가 발생했습니다.",
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
                  <p className="text-caption text-text-tertiary">
                    서비스 내 노출 이름입니다. 실명과 다를 수 있습니다.
                  </p>
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
                <div>
                  <h3 className="text-body-sm font-semibold text-text-primary">
                    예매 이력 (읽기 전용)
                  </h3>
                  <ul className="mt-2 space-y-2 text-body-sm text-text-secondary">
                    <li>
                      DAY6 콘서트 · A-12 · 현장 수령 ·{" "}
                      {formatKst("2026-04-01T18:00:00.000Z")}
                    </li>
                    <li>
                      아이유 콘서트 · B-04 · 배송 ·{" "}
                      {formatKst("2025-12-20T15:30:00.000Z")}
                    </li>
                  </ul>
                </div>
                <div>
                  <h3 className="text-body-sm font-semibold text-text-primary">
                    팔로우 아티스트 (읽기 전용)
                  </h3>
                  <p className="mt-2 text-body-sm text-text-secondary">
                    아이유, DAY6, 검정치마
                  </p>
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
                        const res = await fetch(
                          `/api/admin/users/${sheetUser.id}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              displayName: editName,
                              role: editAdmin ? "admin" : "user",
                            }),
                          },
                        );
                        if (!res.ok) {
                          const errorJson = (await res.json()) as {
                            detail?: string;
                          };
                          throw new Error(errorJson.detail ?? "저장 실패");
                        }
                        await refetch();
                        toast.success("프로필이 저장되었습니다.");
                        setSheetUser(null);
                      } catch (error) {
                        toast.error("저장 실패", {
                          description:
                            error instanceof Error
                              ? error.message
                              : "알 수 없는 오류가 발생했습니다.",
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
                  const res = await fetch(
                    `/api/admin/users/${deleteTarget.id}`,
                    {
                      method: "DELETE",
                    },
                  );
                  if (!res.ok) {
                    const errorJson = (await res.json()) as { detail?: string };
                    throw new Error(errorJson.detail ?? "삭제 실패");
                  }
                  await refetch();
                  toast.success("계정이 삭제되었습니다.");
                  setDeleteTarget(null);
                  setSheetUser(null);
                } catch (error) {
                  toast.error("삭제 실패", {
                    description:
                      error instanceof Error
                        ? error.message
                        : "알 수 없는 오류가 발생했습니다.",
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

function MetricCard({
  label,
  value,
  delta,
  deltaPositive,
  badge,
  loading,
  emphasize,
}: {
  label: string;
  value: number;
  delta: string;
  deltaPositive?: boolean;
  badge?: string;
  loading?: boolean;
  emphasize?: boolean;
}) {
  return (
    <Card
      className={cn(
        emphasize &&
          "border-warning/40 bg-warning-weak/30 dark:bg-warning-weak/10",
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="text-body-sm font-medium text-text-secondary">
          {label}
        </CardTitle>
        {badge ? (
          <Badge variant="outline" className="text-caption">
            {badge}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-10 w-24" />
        ) : (
          <p className="text-display tabular-nums text-text-primary">{value}</p>
        )}
        <p
          className={cn(
            "mt-2 text-body-sm",
            deltaPositive ? "text-success" : "text-text-tertiary",
          )}
        >
          {delta}
        </p>
      </CardContent>
    </Card>
  );
}
