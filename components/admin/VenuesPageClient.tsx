"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import type { VenueRow } from "@/types/venue";
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
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import {
  DEFAULT_ADMIN_PAGE_SIZE,
  type AdminPageSize,
} from "@/lib/admin-pagination";
import {
  CompletenessFilterBar,
  type CompletenessStats,
} from "@/components/admin/CompletenessFilterBar";
import { MissingFieldChips } from "@/components/admin/MissingFieldChips";
import { VENUE_FIELDS } from "@/lib/completeness";
import { VenueDedupSheet } from "@/components/admin/VenueDedupSheet";
import {
  SortableTableHead,
  type SortDir,
} from "@/components/admin/SortableTableHead";

export function VenuesPageClient() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createLoading, setCreateLoading] = React.useState(false);
  const [newVenue, setNewVenue] = React.useState<VenueRow>({
    id: "",
    name: "",
    address: "",
    phone_number: "",
  });

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<
    Pick<VenueRow, "name" | "address" | "phone_number">
  >({
    name: "",
    address: "",
    phone_number: "",
  });

  const [search, setSearch] = React.useState("");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<AdminPageSize>(
    DEFAULT_ADMIN_PAGE_SIZE,
  );
  const [missingFilter, setMissingFilter] = React.useState<string | null>(null);
  const [duplicatesFilter, setDuplicatesFilter] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] =
    React.useState(false);
  const [bulkDeleting, setBulkDeleting] = React.useState(false);
  const [dedupOpen, setDedupOpen] = React.useState(false);
  const [sortBy, setSortBy] = React.useState("name");
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
    setPage(1);
  };

  React.useEffect(() => {
    setPage(1);
  }, [search, missingFilter, duplicatesFilter]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: [
      "admin-venues",
      search,
      page,
      pageSize,
      missingFilter,
      duplicatesFilter,
      sortBy,
      sortDir,
    ],
    queryFn: async () => {
      const q = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortDir,
      });
      if (search.trim()) q.set("q", search.trim());
      if (missingFilter) q.set("missing", missingFilter);
      if (duplicatesFilter) q.set("duplicates", "true");
      const res = await fetch(`/api/admin/venues?${q}`, { cache: "no-store" });
      const json = (await res.json()) as {
        rows?: VenueRow[];
        warning?: string;
        detail?: string;
        total?: number;
        totalPages?: number;
        page?: number;
        pageSize?: number;
      };
      if (!res.ok) {
        throw new Error(json.detail ?? "공연장 목록을 불러오지 못했습니다.");
      }
      if (json.warning) {
        toast.message("안내", { description: json.warning });
      }
      return {
        rows: json.rows ?? [],
        total: json.total ?? 0,
        totalPages: json.totalPages ?? 1,
        page: json.page ?? page,
        pageSize: (json.pageSize ?? pageSize) as AdminPageSize,
      };
    },
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-venues-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/venues/stats", {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return res.json() as Promise<CompletenessStats>;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const list = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelectedIds(
      selectedIds.size === list.length
        ? new Set()
        : new Set(list.map((row) => row.id)),
    );

  const startEdit = (row: VenueRow) => {
    setEditingId(row.id);
    setDraft({
      name: row.name,
      address: row.address,
      phone_number: row.phone_number,
    });
  };

  const saveEdit = async (id: string) => {
    if (!draft.name.trim()) {
      toast.error("공연장 이름은 필수입니다.");
      return;
    }
    const res = await fetch(`/api/admin/venues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const json = (await res.json()) as { detail?: string };
    if (!res.ok) {
      toast.error("수정 실패", {
        description: json.detail ?? "공연장 수정 중 오류가 발생했습니다.",
      });
      return;
    }
    toast.success("공연장이 수정되었습니다.");
    setEditingId(null);
    await refetch();
    queryClient.invalidateQueries({ queryKey: ["admin-events"] });
  };

  const removeVenue = (id: string) => setDeleteId(id);

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    setBulkDeleting(true);
    try {
      const res = await fetch("/api/admin/venues/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action: "delete" }),
      });
      const json = (await res.json()) as { detail?: string };
      if (!res.ok) {
        toast.error("일괄 삭제 실패", {
          description: json.detail ?? "공연장 삭제 중 오류가 발생했습니다.",
        });
        return;
      }
      toast.success(`${ids.length}건 삭제 완료`);
      setSelectedIds(new Set());
      const result = await refetch();
      if (result.data?.rows.length === 0 && page > 1) setPage((p) => p - 1);
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    } finally {
      setBulkDeleting(false);
      setBulkDeleteConfirmOpen(false);
    }
  };

  const confirmRemove = async () => {
    if (!deleteId) return;
    const res = await fetch(`/api/admin/venues/${deleteId}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { detail?: string };
    setDeleteId(null);
    if (!res.ok) {
      toast.error("삭제 실패", {
        description: json.detail ?? "공연장 삭제 중 오류가 발생했습니다.",
      });
      return;
    }
    toast.success("공연장이 삭제되었습니다.");
    const result = await refetch();
    if (result.data?.rows.length === 0 && page > 1) setPage((p) => p - 1);
    queryClient.invalidateQueries({ queryKey: ["admin-events"] });
  };

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "공연장" },
        ]}
        title="공연장 관리"
        description="공연장 기본 정보를 생성/수정/삭제하고 인라인으로 빠르게 편집합니다."
        action={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDedupOpen(true)}
            >
              🏟️ 중복 검토
            </Button>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="h-5 w-5" strokeWidth={1.6} aria-hidden />
              공연장 추가
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-h3">공연장 목록</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <Input
            placeholder="공연장명 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <CompletenessFilterBar
            fields={VENUE_FIELDS}
            stats={stats ?? null}
            statsLoading={statsLoading}
            missingFilter={missingFilter}
            duplicatesFilter={duplicatesFilter}
            onMissingFilter={setMissingFilter}
            onDuplicatesFilter={setDuplicatesFilter}
          />
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-brand/40 bg-brand/5 px-3 py-2 text-body-sm">
              <span className="font-medium text-brand">
                {selectedIds.size}개 선택됨
              </span>
              <Button
                size="sm"
                variant="danger"
                disabled={bulkDeleting}
                onClick={() => setBulkDeleteConfirmOpen(true)}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                삭제
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
              >
                취소
              </Button>
            </div>
          )}
          {isLoading ? (
            <div className="space-y-2" aria-busy>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : list.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface-muted/40 py-12 text-center">
              <p className="text-body text-text-secondary">
                등록된 공연장이 없습니다.
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <input
                        type="checkbox"
                        className="cursor-pointer"
                        checked={
                          selectedIds.size === list.length && list.length > 0
                        }
                        onChange={toggleAll}
                      />
                    </TableHead>
                    <SortableTableHead
                      field="name"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    >
                      이름
                    </SortableTableHead>
                    <SortableTableHead
                      field="address"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    >
                      주소
                    </SortableTableHead>
                    <TableHead>연락처</TableHead>
                    <TableHead>완성도</TableHead>
                    <TableHead className="w-[140px]">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((row) => {
                    const editing = editingId === row.id;
                    return (
                      <TableRow
                        key={row.id}
                        data-selected={selectedIds.has(row.id)}
                        className="data-[selected=true]:bg-brand/5"
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            className="cursor-pointer"
                            checked={selectedIds.has(row.id)}
                            onChange={() => toggleSelect(row.id)}
                          />
                        </TableCell>
                        <TableCell>
                          {editing ? (
                            <Input
                              value={draft.name}
                              onChange={(e) =>
                                setDraft((s) => ({
                                  ...s,
                                  name: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void saveEdit(row.id);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                            />
                          ) : (
                            row.name || "-"
                          )}
                        </TableCell>
                        <TableCell>
                          {editing ? (
                            <Input
                              value={draft.address}
                              onChange={(e) =>
                                setDraft((s) => ({
                                  ...s,
                                  address: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void saveEdit(row.id);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                            />
                          ) : (
                            row.address || "-"
                          )}
                        </TableCell>
                        <TableCell>
                          {editing ? (
                            <Input
                              value={draft.phone_number}
                              onChange={(e) =>
                                setDraft((s) => ({
                                  ...s,
                                  phone_number: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void saveEdit(row.id);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                            />
                          ) : (
                            row.phone_number || "-"
                          )}
                        </TableCell>
                        <TableCell>
                          {!editing && (
                            <MissingFieldChips
                              row={row as Record<string, unknown>}
                              fields={VENUE_FIELDS}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {editing ? (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => void saveEdit(row.id)}
                              >
                                저장
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingId(null)}
                              >
                                취소
                              </Button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => startEdit(row)}
                              >
                                편집
                              </Button>
                              <Button
                                size="icon"
                                variant="danger-weak"
                                aria-label="공연장 삭제"
                                onClick={() => void removeVenue(row.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <AdminListPagination
                page={page}
                totalPages={totalPages}
                pageSize={pageSize}
                total={total}
                rowCountOnPage={list.length}
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>공연장 추가</DialogTitle>
            <DialogDescription>
              공연장 이름, 주소, 연락처를 입력하세요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="venue-name">공연장 이름</Label>
              <Input
                id="venue-name"
                value={newVenue.name}
                onChange={(e) =>
                  setNewVenue((s) => ({ ...s, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="venue-address">주소</Label>
              <Input
                id="venue-address"
                value={newVenue.address}
                onChange={(e) =>
                  setNewVenue((s) => ({ ...s, address: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="venue-phone">연락처</Label>
              <Input
                id="venue-phone"
                value={newVenue.phone_number}
                onChange={(e) =>
                  setNewVenue((s) => ({ ...s, phone_number: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              취소
            </Button>
            <Button
              loading={createLoading}
              onClick={async () => {
                if (!newVenue.name.trim()) {
                  toast.error("공연장 이름은 필수입니다.");
                  return;
                }
                setCreateLoading(true);
                try {
                  const res = await fetch("/api/admin/venues", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(newVenue),
                  });
                  const json = (await res.json()) as { detail?: string };
                  if (!res.ok) {
                    throw new Error(json.detail ?? "공연장 생성 실패");
                  }
                  toast.success("공연장이 추가되었습니다.");
                  setCreateOpen(false);
                  setNewVenue({
                    id: "",
                    name: "",
                    address: "",
                    phone_number: "",
                  });
                  await refetch();
                  queryClient.invalidateQueries({ queryKey: ["admin-events"] });
                } catch (error) {
                  toast.error("추가 실패", {
                    description:
                      error instanceof Error
                        ? error.message
                        : "알 수 없는 오류가 발생했습니다.",
                  });
                } finally {
                  setCreateLoading(false);
                }
              }}
            >
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>공연장 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 공연장을 삭제하면 복구할 수 없습니다. 계속하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRemove()}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={(o) => !o && setBulkDeleteConfirmOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedIds.size}건을 일괄 삭제할까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              선택한 공연장 {selectedIds.size}건이 모두 삭제됩니다. 되돌릴 수
              없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => void bulkDelete()}>
              {bulkDeleting ? "삭제 중..." : "삭제"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VenueDedupSheet
        open={dedupOpen}
        onClose={() => {
          setDedupOpen(false);
          void refetch();
        }}
      />
    </div>
  );
}
