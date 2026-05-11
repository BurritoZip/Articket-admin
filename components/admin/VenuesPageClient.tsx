"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
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

export function VenuesPageClient() {
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

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<AdminPageSize>(
    DEFAULT_ADMIN_PAGE_SIZE,
  );
  const [missingFilter, setMissingFilter] = React.useState<string | null>(null);
  const [duplicatesFilter, setDuplicatesFilter] = React.useState(false);

  React.useEffect(() => {
    setPage(1);
  }, [missingFilter, duplicatesFilter]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-venues", page, pageSize, missingFilter, duplicatesFilter],
    queryFn: async () => {
      const q = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
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
  };

  const removeVenue = async (id: string) => {
    if (!window.confirm("이 공연장을 삭제할까요?")) return;
    const res = await fetch(`/api/admin/venues/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { detail?: string };
    if (!res.ok) {
      toast.error("삭제 실패", {
        description: json.detail ?? "공연장 삭제 중 오류가 발생했습니다.",
      });
      return;
    }
    toast.success("공연장이 삭제되었습니다.");
    await refetch();
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
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="h-5 w-5" strokeWidth={1.6} aria-hidden />
            공연장 추가
          </Button>
        }
      />

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-h3">공연장 목록</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <CompletenessFilterBar
            fields={VENUE_FIELDS}
            stats={stats ?? null}
            statsLoading={statsLoading}
            missingFilter={missingFilter}
            duplicatesFilter={duplicatesFilter}
            onMissingFilter={setMissingFilter}
            onDuplicatesFilter={setDuplicatesFilter}
          />
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
                    <TableHead>이름</TableHead>
                    <TableHead>주소</TableHead>
                    <TableHead>연락처</TableHead>
                    <TableHead>완성도</TableHead>
                    <TableHead className="w-[140px]">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((row) => {
                    const editing = editingId === row.id;
                    return (
                      <TableRow key={row.id}>
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
                                if (e.key === "Enter") {
                                  void saveEdit(row.id);
                                }
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
                                if (e.key === "Enter") {
                                  void saveEdit(row.id);
                                }
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
                                if (e.key === "Enter") {
                                  void saveEdit(row.id);
                                }
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
    </div>
  );
}
