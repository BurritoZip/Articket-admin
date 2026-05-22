"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ListMusic,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/Sheet";
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
import { differenceInCalendarDays, parseISO } from "date-fns";
import { formatKst } from "@/lib/format-kst";
import { ImageUploader } from "@/components/admin/ImageUploader";
import type { EventRow, EventStatus, OptionItem } from "@/types/event";
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
import { EVENT_FIELDS } from "@/lib/completeness";
import { TimetableSheet } from "@/components/admin/TimetableSheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
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
import type { TimetablePerformanceRow } from "@/types/timetable";

type EventQueryResponse = {
  rows: EventRow[];
  artists: OptionItem[];
  venues: OptionItem[];
  warning?: string;
  total?: number;
  totalPages?: number;
  page?: number;
  pageSize?: number;
};

const STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: "예정",
  on_sale: "예매중",
  ended: "종료",
};

export function EventsPageClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<AdminPageSize>(
    DEFAULT_ADMIN_PAGE_SIZE,
  );

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [timetableOpen, setTimetableOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const [editingEvent, setEditingEvent] = React.useState<EventRow | null>(null);
  const [detailEvent, setDetailEvent] = React.useState<EventRow | null>(null);
  const [timetableEvent, setTimetableEvent] = React.useState<EventRow | null>(
    null,
  );
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const [form, setForm] = React.useState<Partial<EventRow>>({
    title: "",
    artist_id: "",
    venue_id: "",
    start_date: "",
    end_date: "",
    status: "upcoming",
    genre: "",
    is_banner: false,
  });

  const [missingFilter, setMissingFilter] = React.useState<string | null>(null);
  const [duplicatesFilter, setDuplicatesFilter] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = React.useState(false);

  React.useEffect(() => {
    setPage(1);
  }, [search, statusFilter, missingFilter, duplicatesFilter]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: [
      "admin-events",
      search,
      statusFilter,
      page,
      pageSize,
      missingFilter,
      duplicatesFilter,
    ],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (search.trim()) q.set("q", search.trim());
      if (statusFilter !== "all") q.set("status", statusFilter);
      q.set("page", String(page));
      q.set("pageSize", String(pageSize));
      if (missingFilter) q.set("missing", missingFilter);
      if (duplicatesFilter) q.set("duplicates", "true");

      const res = await fetch(`/api/admin/events?${q.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as EventQueryResponse & {
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(json.detail ?? "공연 목록을 불러오지 못했습니다.");
      }
      if (json.warning) {
        toast.message("안내", { description: json.warning });
      }
      return json;
    },
  });

  const { data: detailTimetable } = useQuery({
    queryKey: ["detail-timetable", detailEvent?.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/timetable?event_id=${detailEvent!.id}`,
        { cache: "no-store" },
      );
      if (!res.ok) return [] as TimetablePerformanceRow[];
      const json = (await res.json()) as { rows: TimetablePerformanceRow[] };
      return json.rows;
    },
    enabled: detailOpen && !!detailEvent?.has_timetable,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-events-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/events/stats", {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return res.json() as Promise<CompletenessStats>;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const rows = React.useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const artists = React.useMemo(() => data?.artists ?? [], [data]);
  const venues = React.useMemo(() => data?.venues ?? [], [data]);

  const artistMap = React.useMemo(
    () => new Map(artists.map((a) => [a.id, a.name])),
    [artists],
  );
  const venueMap = React.useMemo(
    () => new Map(venues.map((v) => [v.id, v.name])),
    [venues],
  );

  const openCreate = () => {
    setForm({
      title: "",
      artist_id: artists[0]?.id ?? "",
      venue_id: venues[0]?.id ?? "",
      start_date: "",
      end_date: "",
      status: "upcoming",
      genre: "",
      is_banner: false,
    });
    setCreateOpen(true);
  };

  const openEdit = (event: EventRow) => {
    setEditingEvent(event);
    setForm({
      ...event,
      start_date: event.start_date?.slice(0, 16),
      end_date: event.end_date?.slice(0, 16) ?? "",
    });
    setEditOpen(true);
  };

  const openDetail = (event: EventRow) => {
    setDetailEvent(event);
    setDetailOpen(true);
  };

  const openTimetable = (event: EventRow) => {
    setTimetableEvent(event);
    setTimetableOpen(true);
  };

  const handleTimetableAdded = async () => {
    if (!timetableEvent) return;
    await fetch(`/api/admin/events/${timetableEvent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ has_timetable: true }),
    });
    void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
  };

  const submitCreate = async () => {
    if (
      !form.title?.trim() ||
      !form.artist_id ||
      !form.venue_id ||
      !form.start_date
    ) {
      toast.error("필수 항목을 입력하세요.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          title: form.title.trim(),
          end_date: form.end_date || null,
        }),
      });
      const json = (await res.json()) as { detail?: string };
      if (!res.ok) throw new Error(json.detail ?? "생성 실패");
      toast.success("공연이 추가되었습니다.");
      setCreateOpen(false);
      await refetch();
    } catch (error) {
      toast.error("생성 실패", {
        description:
          error instanceof Error
            ? error.message
            : "알 수 없는 오류가 발생했습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async () => {
    if (!editingEvent) return;
    if (!form.title?.trim() || !form.start_date) {
      toast.error("필수 항목을 입력하세요.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/events/${editingEvent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          title: form.title.trim(),
          end_date: form.end_date || null,
        }),
      });
      const json = (await res.json()) as { detail?: string };
      if (!res.ok) throw new Error(json.detail ?? "수정 실패");
      toast.success("공연이 수정되었습니다.");
      setEditOpen(false);
      setEditingEvent(null);
      await refetch();
    } catch (error) {
      toast.error("수정 실패", {
        description:
          error instanceof Error
            ? error.message
            : "알 수 없는 오류가 발생했습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const patchStatus = async (id: string, status: string) => {
    await fetch(`/api/admin/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
  };

  const patchBanner = async (id: string, is_banner: boolean) => {
    await fetch(`/api/admin/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_banner }),
    });
    void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelectedIds(
      selectedIds.size === rows.length
        ? new Set()
        : new Set(rows.map((r) => r.id)),
    );

  const bulkSetStatus = async (status: string) => {
    const ids = Array.from(selectedIds);
    const res = await fetch("/api/admin/events/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "set_status", payload: { status } }),
    });
    if (!res.ok) {
      toast.error("일괄 상태 변경 실패");
      return;
    }
    toast.success(`${ids.length}건 상태 변경 완료`);
    setSelectedIds(new Set());
    void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    setBulkDeleting(true);
    try {
      const res = await fetch("/api/admin/events/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action: "delete" }),
      });
      if (!res.ok) {
        toast.error("일괄 삭제 실패");
        return;
      }
      toast.success(`${ids.length}건 삭제 완료`);
      setSelectedIds(new Set());
      void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    } finally {
      setBulkDeleting(false);
    }
  };

  const removeEvent = (id: string) => setDeleteId(id);

  const confirmRemove = async () => {
    if (!deleteId) return;
    const res = await fetch(`/api/admin/events/${deleteId}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { detail?: string };
    setDeleteId(null);
    if (!res.ok) {
      toast.error("삭제 실패", { description: json.detail ?? "삭제 실패" });
      return;
    }
    toast.success("공연이 삭제되었습니다.");
    const result = await refetch();
    if (result.data?.rows.length === 0 && page > 1) setPage((p) => p - 1);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "공연" },
        ]}
        title="공연 관리"
        description="공연 정보를 조회/생성/수정/삭제하고 상태를 관리합니다."
        action={
          <Button onClick={openCreate}>
            <Plus className="h-5 w-5" />
            공연 추가
          </Button>
        }
      />

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-h3">공연 목록</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Input
              placeholder="공연명 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="md:max-w-sm"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="md:w-[180px]">
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="upcoming">예정</SelectItem>
                <SelectItem value="on_sale">예매중</SelectItem>
                <SelectItem value="ended">종료</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CompletenessFilterBar
            fields={EVENT_FIELDS}
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
              <Select onValueChange={(v) => void bulkSetStatus(v)}>
                <SelectTrigger className="h-7 w-32 text-xs">
                  <SelectValue placeholder="상태 변경" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">예정</SelectItem>
                  <SelectItem value="on_sale">예매중</SelectItem>
                  <SelectItem value="ended">종료</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="danger"
                disabled={bulkDeleting}
                onClick={() => void bulkDelete()}
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
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface-muted/40 py-12 text-center">
              <p className="text-body text-text-secondary">
                표시할 공연이 없습니다.
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
                          selectedIds.size === rows.length && rows.length > 0
                        }
                        onChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>공연명</TableHead>
                    <TableHead>아티스트</TableHead>
                    <TableHead>공연장</TableHead>
                    <TableHead>시작일</TableHead>
                    <TableHead>티켓오픈</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>완성도</TableHead>
                    <TableHead>배너</TableHead>
                    <TableHead>타임테이블</TableHead>
                    <TableHead className="w-[80px]">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
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
                      <TableCell className="font-medium">{row.title}</TableCell>
                      <TableCell>
                        {artistMap.get(row.artist_id) ?? "-"}
                      </TableCell>
                      <TableCell>{venueMap.get(row.venue_id) ?? "-"}</TableCell>
                      <TableCell>{formatKst(row.start_date)}</TableCell>
                      <TableCell>
                        <TicketOpenBadge date={row.ticket_open_date} />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.status}
                          onValueChange={(v) => void patchStatus(row.id, v)}
                        >
                          <SelectTrigger className="h-7 w-24 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="upcoming">예정</SelectItem>
                            <SelectItem value="on_sale">예매중</SelectItem>
                            <SelectItem value="ended">종료</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <MissingFieldChips
                          row={row as Record<string, unknown>}
                          fields={EVENT_FIELDS}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          className="cursor-pointer"
                          title="클릭으로 배너 ON/OFF"
                          onClick={() =>
                            void patchBanner(row.id, !row.is_banner)
                          }
                        >
                          <Badge
                            variant={row.is_banner ? "success" : "outline"}
                          >
                            {row.is_banner ? "ON" : "OFF"}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={row.has_timetable ? "success" : "outline"}
                          >
                            {row.has_timetable ? "있음" : "없음"}
                          </Badge>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openTimetable(row)}
                          >
                            <ListMusic className="mr-1 h-4 w-4" />
                            관리
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="outline">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(row)}>
                              상세 보기
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEdit(row)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              편집
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-500 focus:text-red-500"
                              onClick={() => void removeEvent(row.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              삭제
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <AdminListPagination
                page={page}
                totalPages={totalPages}
                pageSize={pageSize}
                total={total}
                rowCountOnPage={rows.length}
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
            <DialogTitle>공연 추가</DialogTitle>
            <DialogDescription>
              필수 항목(공연명, 아티스트, 공연장, 시작일)을 입력하세요.
            </DialogDescription>
          </DialogHeader>
          <EventFormFields
            form={form}
            setForm={setForm}
            artists={artists}
            venues={venues}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              취소
            </Button>
            <Button loading={submitting} onClick={() => void submitCreate()}>
              생성
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>공연 수정</DialogTitle>
            <DialogDescription>
              필수 항목(공연명, 아티스트, 공연장, 시작일)을 입력하세요.
            </DialogDescription>
          </DialogHeader>
          <EventFormFields
            form={form}
            setForm={setForm}
            artists={artists}
            venues={venues}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditOpen(false);
                setEditingEvent(null);
              }}
            >
              취소
            </Button>
            <Button loading={submitting} onClick={() => void submitEdit()}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-xl">
          {detailEvent ? (
            <>
              <SheetHeader>
                <SheetTitle>{detailEvent.title}</SheetTitle>
                <SheetDescription>
                  {artistMap.get(detailEvent.artist_id) ?? "-"} ·{" "}
                  {venueMap.get(detailEvent.venue_id) ?? "-"}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto py-4 text-body-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <InfoItem
                    label="상태"
                    value={STATUS_LABEL[detailEvent.status]}
                  />
                  <InfoItem
                    label="배너 노출"
                    value={detailEvent.is_banner ? "ON" : "OFF"}
                  />
                  <InfoItem
                    label="시작일시"
                    value={formatKst(detailEvent.start_date)}
                  />
                  <InfoItem
                    label="종료일시"
                    value={formatKst(detailEvent.end_date)}
                  />
                  <InfoItem label="장르" value={detailEvent.genre ?? "-"} />
                  <InfoItem
                    label="러닝타임"
                    value={detailEvent.duration ?? "-"}
                  />
                  <InfoItem
                    label="관람 연령"
                    value={detailEvent.age_restriction ?? "-"}
                  />
                  <InfoItem
                    label="예매 오픈일"
                    value={formatKst(detailEvent.ticket_open_date)}
                  />
                  <InfoItem
                    label="예매처"
                    value={detailEvent.ticket_provider ?? "-"}
                  />
                  <InfoItem
                    label="포스터 URL"
                    value={detailEvent.poster_url ?? "-"}
                  />
                </div>
                {detailEvent.has_timetable && (
                  <div>
                    <p className="mb-2 text-caption font-semibold text-text-tertiary">
                      타임테이블
                    </p>
                    <div className="space-y-1">
                      {(detailTimetable ?? []).length === 0 ? (
                        <p className="text-caption text-text-tertiary">
                          불러오는 중...
                        </p>
                      ) : (
                        (detailTimetable ?? []).map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-body-sm"
                          >
                            <span className="w-6 shrink-0 text-caption font-semibold text-text-tertiary">
                              D{p.day_number}
                            </span>
                            <span className="w-[90px] shrink-0 text-caption text-text-tertiary">
                              {p.start_time}–{p.end_time}
                            </span>
                            <span className="flex-1 font-medium">
                              {p.artist_name}
                            </span>
                            <span className="text-caption text-text-tertiary">
                              {p.stage_name}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <p className="mb-2 text-caption font-semibold text-text-tertiary">
                    공지
                  </p>
                  <div className="rounded-md border border-border bg-surface-muted/30 p-3 text-text-secondary">
                    {detailEvent.notice_text?.trim() ||
                      "등록된 공지가 없습니다."}
                  </div>
                </div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setDetailOpen(false)}>
                  닫기
                </Button>
                <Button
                  onClick={() => {
                    setDetailOpen(false);
                    openEdit(detailEvent);
                  }}
                >
                  편집하기
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <TimetableSheet
        event={timetableEvent}
        open={timetableOpen}
        onOpenChange={setTimetableOpen}
        onHasTimetableChange={() => void handleTimetableAdded()}
      />

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>공연을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              삭제 후 되돌릴 수 없습니다.
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
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="mt-1 break-all text-text-primary">{value}</p>
    </div>
  );
}

function TicketOpenBadge({ date }: { date: string | null }) {
  if (!date) return <span className="text-text-tertiary">-</span>;
  const diff = differenceInCalendarDays(parseISO(date), new Date());
  if (diff >= 0 && diff <= 7)
    return (
      <Badge variant="warning">
        D-{diff} {formatKst(date)}
      </Badge>
    );
  return <span>{formatKst(date)}</span>;
}

function EventFormFields({
  form,
  setForm,
  artists,
  venues,
}: {
  form: Partial<EventRow>;
  setForm: React.Dispatch<React.SetStateAction<Partial<EventRow>>>;
  artists: OptionItem[];
  venues: OptionItem[];
}) {
  return (
    <div className="grid gap-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="event-title">공연명</Label>
        <Input
          id="event-title"
          value={form.title ?? ""}
          onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>아티스트</Label>
          <Select
            value={form.artist_id ?? ""}
            onValueChange={(v) => setForm((s) => ({ ...s, artist_id: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="아티스트 선택" />
            </SelectTrigger>
            <SelectContent>
              {artists.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>공연장</Label>
          <Select
            value={form.venue_id ?? ""}
            onValueChange={(v) => setForm((s) => ({ ...s, venue_id: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="공연장 선택" />
            </SelectTrigger>
            <SelectContent>
              {venues.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="event-start">시작일시</Label>
          <Input
            id="event-start"
            type="datetime-local"
            value={form.start_date ? form.start_date.slice(0, 16) : ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, start_date: e.target.value }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-end">종료일시</Label>
          <Input
            id="event-end"
            type="datetime-local"
            value={form.end_date ? form.end_date.slice(0, 16) : ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, end_date: e.target.value }))
            }
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>상태</Label>
          <Select
            value={(form.status as string) ?? "upcoming"}
            onValueChange={(v: EventStatus) =>
              setForm((s) => ({ ...s, status: v }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upcoming">예정</SelectItem>
              <SelectItem value="on_sale">예매중</SelectItem>
              <SelectItem value="ended">종료</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-genre">장르</Label>
          <Input
            id="event-genre"
            value={form.genre ?? ""}
            onChange={(e) => setForm((s) => ({ ...s, genre: e.target.value }))}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>포스터 이미지</Label>
        <ImageUploader
          value={form.poster_url ?? ""}
          onChange={(url) => setForm((s) => ({ ...s, poster_url: url }))}
          folder="posters"
          placeholder="포스터 이미지"
        />
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border p-3 text-body-sm text-text-secondary">
        <CalendarDays className="h-4 w-4" />
        모든 날짜/시간은 KST 기준으로 표시됩니다.
      </div>
    </div>
  );
}
