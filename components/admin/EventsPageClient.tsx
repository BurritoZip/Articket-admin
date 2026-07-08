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
import { Textarea } from "@/components/ui/Textarea";
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
  SortableTableHead,
  type SortDir,
} from "@/components/admin/SortableTableHead";
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
  eventArtists?: {
    event_id: string;
    artist_id: string;
    artist_name: string;
    display_order: number;
  }[];
  eventVenues?: { event_id: string; venue_id: string; display_order: number }[];
  warning?: string;
  total?: number;
  totalPages?: number;
  page?: number;
  pageSize?: number;
};

const STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: "예정",
  on_sale: "예매중",
  ongoing: "진행중",
  ended: "종료",
};

export function EventsPageClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
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
  const [fromUrlOpen, setFromUrlOpen] = React.useState(false);
  const [fromUrlInput, setFromUrlInput] = React.useState("");
  const [fromUrlLoading, setFromUrlLoading] = React.useState(false);

  const [editingEvent, setEditingEvent] = React.useState<EventRow | null>(null);
  const [detailEvent, setDetailEvent] = React.useState<EventRow | null>(null);
  const [timetableEvent, setTimetableEvent] = React.useState<EventRow | null>(
    null,
  );
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] =
    React.useState(false);

  const emptyForm: Partial<EventRow> = {
    title: "",
    artist_id: "",
    venue_id: "",
    start_date: "",
    end_date: "",
    status: "upcoming",
    genre: "",
    duration: "",
    age_restriction: "",
    ticket_open_date: "",
    ticket_provider: "",
    notice_text: "",
    is_banner: false,
  };

  const [form, setForm] = React.useState<Partial<EventRow>>(emptyForm);
  const [artistIds, setArtistIds] = React.useState<string[]>([]);
  const [venueIds, setVenueIds] = React.useState<string[]>([]);
  const [missingFilter, setMissingFilter] = React.useState<string | null>(null);
  const [duplicatesFilter, setDuplicatesFilter] = React.useState(false);
  const [noArtistLinkFilter, setNoArtistLinkFilter] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = React.useState(false);
  const [sortBy, setSortBy] = React.useState("start_date");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir(field === "start_date" ? "desc" : "asc");
    }
    setPage(1);
  };

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    setPage(1);
  }, [statusFilter, missingFilter, duplicatesFilter, noArtistLinkFilter]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: [
      "admin-events",
      debouncedSearch,
      statusFilter,
      page,
      pageSize,
      missingFilter,
      duplicatesFilter,
      noArtistLinkFilter,
      sortBy,
      sortDir,
    ],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (debouncedSearch.trim()) q.set("q", debouncedSearch.trim());
      if (statusFilter !== "all") q.set("status", statusFilter);
      q.set("page", String(page));
      q.set("pageSize", String(pageSize));
      q.set("sortBy", sortBy);
      q.set("sortDir", sortDir);
      if (missingFilter) q.set("missing", missingFilter);
      if (duplicatesFilter) q.set("duplicates", "true");
      if (noArtistLinkFilter) q.set("no_artist_link", "true");

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

  // event_id → sorted artist list
  const eventArtistsMap = React.useMemo(() => {
    const map = new Map<string, { artist_id: string; artist_name: string }[]>();
    for (const ea of data?.eventArtists ?? []) {
      const list = map.get(ea.event_id) ?? [];
      list.push({ artist_id: ea.artist_id, artist_name: ea.artist_name });
      map.set(ea.event_id, list);
    }
    return map;
  }, [data]);

  // event_id → sorted venue id list
  const eventVenuesMap = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const ev of data?.eventVenues ?? []) {
      const list = map.get(ev.event_id) ?? [];
      list.push(ev.venue_id);
      map.set(ev.event_id, list);
    }
    return map;
  }, [data]);

  const openCreate = () => {
    setForm({ ...emptyForm });
    setArtistIds([]);
    setVenueIds([]);
    setCreateOpen(true);
  };

  const importFromUrl = async () => {
    const url = fromUrlInput.trim();
    if (!url) return;
    setFromUrlLoading(true);
    try {
      const res = await fetch("/api/admin/events/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = (await res.json()) as {
        parsed?: {
          title?: string | null;
          posterUrl?: string | null;
          startDate?: string | null;
          endDate?: string | null;
          ticketOpenDate?: string | null;
          ticketProvider?: string | null;
          genre?: string | null;
          artists?: string[];
          venueName?: string | null;
        };
        detail?: string;
      };
      if (!res.ok) throw new Error(json.detail ?? "불러오기 실패");
      const p = json.parsed ?? {};

      // 아티스트명 → DB artist 이름 매칭
      const parsedArtistNames = p.artists ?? [];
      const matchedArtistIds = parsedArtistNames
        .map((name) =>
          artists.find(
            (a) =>
              a.name.toLowerCase() === name.toLowerCase() ||
              a.name.toLowerCase().includes(name.toLowerCase()) ||
              name.toLowerCase().includes(a.name.toLowerCase()),
          ),
        )
        .filter(Boolean)
        .map((a) => a!.id);

      // 장소명 → DB venue 이름 매칭
      const parsedVenueName = (p.venueName ?? "").toLowerCase();
      const matchedVenue = parsedVenueName
        ? venues.find(
            (v) =>
              v.name.toLowerCase().includes(parsedVenueName) ||
              parsedVenueName.includes(v.name.toLowerCase()),
          )
        : undefined;

      setForm({
        ...emptyForm,
        title: p.title ?? "",
        poster_url: p.posterUrl ?? "",
        start_date: p.startDate ? `${p.startDate}T00:00` : "",
        end_date: p.endDate ? `${p.endDate}T00:00` : "",
        ticket_open_date: p.ticketOpenDate ? `${p.ticketOpenDate}T00:00` : "",
        ticket_provider: p.ticketProvider ?? "",
        genre: p.genre ?? "",
      });
      setArtistIds(matchedArtistIds);
      setVenueIds(matchedVenue ? [matchedVenue.id] : []);

      setFromUrlOpen(false);
      setFromUrlInput("");
      setCreateOpen(true);

      const artistMsg =
        matchedArtistIds.length > 0
          ? `아티스트 ${matchedArtistIds.length}명 자동 선택됨.`
          : "아티스트를 직접 선택하세요.";
      const venueMsg = matchedVenue
        ? `공연장 "${matchedVenue.name}" 자동 선택됨.`
        : p.venueName
          ? `공연장 "${p.venueName}"을 직접 선택하세요.`
          : "공연장을 직접 선택하세요.";
      toast.success("URL에서 정보를 가져왔습니다.", {
        description: `${artistMsg} ${venueMsg}`,
      });
    } catch (e) {
      toast.error("가져오기 실패", {
        description: e instanceof Error ? e.message : "알 수 없는 오류",
      });
    } finally {
      setFromUrlLoading(false);
    }
  };

  const openEdit = (event: EventRow) => {
    setEditingEvent(event);
    setForm({
      ...event,
      start_date: event.start_date?.slice(0, 16),
      end_date: event.end_date?.slice(0, 16) ?? "",
      ticket_open_date: event.ticket_open_date?.slice(0, 16) ?? "",
    });
    const eaList = eventArtistsMap.get(event.id);
    setArtistIds(
      eaList && eaList.length > 0
        ? eaList.map((a) => a.artist_id)
        : event.artist_id
          ? [event.artist_id]
          : [],
    );
    const evList = eventVenuesMap.get(event.id);
    setVenueIds(
      evList && evList.length > 0
        ? evList
        : event.venue_id
          ? [event.venue_id]
          : [],
    );
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
      !form.start_date ||
      artistIds.length === 0 ||
      venueIds.length === 0
    ) {
      toast.error("필수 항목을 입력하세요. (공연명, 아티스트, 공연장, 시작일)");
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
          artist_ids: artistIds,
          venue_ids: venueIds,
          end_date: form.end_date || null,
          ticket_open_date: form.ticket_open_date || null,
          duration: form.duration || null,
          age_restriction: form.age_restriction || null,
          ticket_provider: form.ticket_provider || null,
          notice_text: form.notice_text || null,
        }),
      });
      const json = (await res.json()) as { detail?: string };
      if (!res.ok) throw new Error(json.detail ?? "생성 실패");
      toast.success("공연이 추가되었습니다.");
      setCreateOpen(false);
      await refetch();
    } catch (error) {
      toast.error("생성 실패", {
        description: error instanceof Error ? error.message : "알 수 없는 오류",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async () => {
    if (!editingEvent) return;
    // 편집은 공연명·시작일만 필수. 아티스트/공연장은 비어 있어도 허용
    // (페스티벌·미연결 공연도 예매링크 등 다른 필드를 수정할 수 있어야 함).
    if (!form.title?.trim() || !form.start_date) {
      toast.error("필수 항목을 입력하세요. (공연명, 시작일)");
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
          artist_ids: artistIds,
          venue_ids: venueIds,
          end_date: form.end_date || null,
          ticket_open_date: form.ticket_open_date || null,
          duration: form.duration || null,
          age_restriction: form.age_restriction || null,
          ticket_provider: form.ticket_provider || null,
          booking_url: form.booking_url?.trim() || null,
          notice_text: form.notice_text || null,
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
        description: error instanceof Error ? error.message : "알 수 없는 오류",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const patchStatus = async (id: string, status: string) => {
    const res = await fetch(`/api/admin/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.error("상태 변경 실패");
      void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
  };

  const patchBanner = async (id: string, is_banner: boolean) => {
    const res = await fetch(`/api/admin/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_banner }),
    });
    if (!res.ok) {
      toast.error("배너 설정 실패");
      void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      return;
    }
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
      setBulkDeleteConfirmOpen(false);
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
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setFromUrlInput("");
                setFromUrlOpen(true);
              }}
            >
              URL로 추가
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-5 w-5" />
              공연 추가
            </Button>
          </div>
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
                <SelectItem value="ongoing">진행중</SelectItem>
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
          {/* 아티스트 미연결 빠른 필터 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setNoArtistLinkFilter((prev) => !prev);
                setMissingFilter(null);
                setDuplicatesFilter(false);
              }}
              className={[
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption font-medium transition-colors",
                noArtistLinkFilter
                  ? "border-danger bg-danger-weak text-danger"
                  : "border-border bg-surface text-text-secondary hover:border-danger/60 hover:text-danger",
              ].join(" ")}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              아티스트 미연결
            </button>
          </div>

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
                  <SelectItem value="ongoing">진행중</SelectItem>
                  <SelectItem value="ended">종료</SelectItem>
                </SelectContent>
              </Select>
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
                    <SortableTableHead
                      field="title"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    >
                      공연명
                    </SortableTableHead>
                    <TableHead>아티스트</TableHead>
                    <TableHead>공연장</TableHead>
                    <SortableTableHead
                      field="start_date"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    >
                      시작일
                    </SortableTableHead>
                    <TableHead>티켓오픈</TableHead>
                    <SortableTableHead
                      field="status"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    >
                      상태
                    </SortableTableHead>
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
                        <ArtistLinkBadges
                          eventId={row.id}
                          artistId={row.artist_id}
                          eventArtistsMap={eventArtistsMap}
                          artistMap={artistMap}
                        />
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const ev = eventVenuesMap.get(row.id);
                          if (ev && ev.length > 0)
                            return ev
                              .map((vid) => venueMap.get(vid) ?? vid)
                              .join(", ");
                          return venueMap.get(row.venue_id) ?? "-";
                        })()}
                      </TableCell>
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
                            <SelectItem value="ongoing">진행중</SelectItem>
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

      {/* 생성 다이얼로그 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
            artistIds={artistIds}
            setArtistIds={setArtistIds}
            venueIds={venueIds}
            setVenueIds={setVenueIds}
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

      {/* 수정 다이얼로그 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
            artistIds={artistIds}
            setArtistIds={setArtistIds}
            venueIds={venueIds}
            setVenueIds={setVenueIds}
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

      {/* 상세 시트 */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-xl">
          {detailEvent ? (
            <>
              <SheetHeader>
                <SheetTitle>{detailEvent.title}</SheetTitle>
                <SheetDescription>
                  {(() => {
                    const ea = eventArtistsMap.get(detailEvent.id);
                    return ea && ea.length > 0
                      ? ea.map((a) => a.artist_name).join(", ")
                      : (artistMap.get(detailEvent.artist_id) ?? "-");
                  })()}{" "}
                  ·{" "}
                  {(() => {
                    const ev = eventVenuesMap.get(detailEvent.id);
                    return ev && ev.length > 0
                      ? ev.map((vid) => venueMap.get(vid) ?? vid).join(", ")
                      : (venueMap.get(detailEvent.venue_id) ?? "-");
                  })()}
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
                </div>
                {detailEvent.poster_url && (
                  <div>
                    <p className="mb-2 text-caption font-semibold text-text-tertiary">
                      포스터
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={detailEvent.poster_url}
                      alt="포스터"
                      className="h-40 w-auto rounded-md border border-border object-contain"
                    />
                  </div>
                )}
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
                  <div className="rounded-md border border-border bg-surface-muted/30 p-3 text-text-secondary whitespace-pre-wrap">
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

      {/* 단건 삭제 확인 */}
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

      {/* 벌크 삭제 확인 */}
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
              선택한 공연 {selectedIds.size}건이 모두 삭제됩니다. 되돌릴 수
              없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void bulkDelete()}
            >
              {bulkDeleting ? "삭제 중..." : "삭제"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* URL로 공연 추가 */}
      <Dialog open={fromUrlOpen} onOpenChange={setFromUrlOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>URL로 공연 추가</DialogTitle>
            <DialogDescription>
              StagePick 공연 상세 URL을 붙여넣으면 정보를 자동으로 가져옵니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="from-url-input">공연 URL</Label>
            <Input
              id="from-url-input"
              placeholder="https://www.stagepick.co.kr/performances/detail/..."
              value={fromUrlInput}
              onChange={(e) => setFromUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void importFromUrl();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFromUrlOpen(false)}>
              취소
            </Button>
            <Button
              loading={fromUrlLoading}
              disabled={!fromUrlInput.trim()}
              onClick={() => void importFromUrl()}
            >
              가져오기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function MultiSelect({
  label,
  required,
  options,
  selectedIds,
  setSelectedIds,
  placeholder,
}: {
  label: string;
  required?: boolean;
  options: OptionItem[];
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  placeholder: string;
}) {
  const selectedSet = new Set(selectedIds);
  const unselected = options.filter((o) => !selectedSet.has(o.id));
  const nameMap = new Map(options.map((o) => [o.id, o.name]));

  return (
    <div className="space-y-2">
      <Label>
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedIds.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs"
            >
              {nameMap.get(id) ?? id}
              <button
                type="button"
                className="ml-0.5 text-text-tertiary hover:text-text-primary"
                onClick={() =>
                  setSelectedIds((prev) => prev.filter((x) => x !== id))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {unselected.length > 0 && (
        <Select
          value=""
          onValueChange={(v) => {
            if (v) setSelectedIds((prev) => [...prev, v]);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {unselected.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function EventFormFields({
  form,
  setForm,
  artists,
  venues,
  artistIds,
  setArtistIds,
  venueIds,
  setVenueIds,
}: {
  form: Partial<EventRow>;
  setForm: React.Dispatch<React.SetStateAction<Partial<EventRow>>>;
  artists: OptionItem[];
  venues: OptionItem[];
  artistIds: string[];
  setArtistIds: React.Dispatch<React.SetStateAction<string[]>>;
  venueIds: string[];
  setVenueIds: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <div className="grid gap-4 py-2">
      {/* 기본 정보 */}
      <div className="space-y-2">
        <Label htmlFor="event-title">
          공연명 <span className="text-red-500">*</span>
        </Label>
        <Input
          id="event-title"
          value={form.title ?? ""}
          onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <MultiSelect
          label="아티스트"
          required
          options={artists}
          selectedIds={artistIds}
          setSelectedIds={setArtistIds}
          placeholder="아티스트 추가"
        />
        <MultiSelect
          label="공연장"
          required
          options={venues}
          selectedIds={venueIds}
          setSelectedIds={setVenueIds}
          placeholder="공연장 추가"
        />
      </div>

      {/* 날짜 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="event-start">
            시작일시 <span className="text-red-500">*</span>
          </Label>
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
          <Label htmlFor="event-ticket-open">예매 오픈일시</Label>
          <Input
            id="event-ticket-open"
            type="datetime-local"
            value={
              form.ticket_open_date ? form.ticket_open_date.slice(0, 16) : ""
            }
            onChange={(e) =>
              setForm((s) => ({ ...s, ticket_open_date: e.target.value }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-ticket-provider">예매처</Label>
          <Input
            id="event-ticket-provider"
            placeholder="예) 인터파크, YES24"
            value={form.ticket_provider ?? ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, ticket_provider: e.target.value }))
            }
          />
        </div>
      </div>

      {/* 예매 링크 — 앱 '예매하기' 버튼이 여는 외부 URL */}
      <div className="space-y-2">
        <Label htmlFor="event-booking-url">예매 링크 (booking_url)</Label>
        <Input
          id="event-booking-url"
          type="url"
          placeholder="https://tickets.interpark.com/goods/..."
          value={form.booking_url ?? ""}
          onChange={(e) =>
            setForm((s) => ({ ...s, booking_url: e.target.value }))
          }
        />
      </div>

      {/* 공연 정보 */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>
            상태 <span className="text-red-500">*</span>
          </Label>
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
              <SelectItem value="ongoing">진행중</SelectItem>
              <SelectItem value="ended">종료</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-genre">장르</Label>
          <Input
            id="event-genre"
            placeholder="예) K-POP, ROCK"
            value={form.genre ?? ""}
            onChange={(e) => setForm((s) => ({ ...s, genre: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-duration">러닝타임</Label>
          <Input
            id="event-duration"
            placeholder="예) 120분"
            value={form.duration ?? ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, duration: e.target.value }))
            }
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="event-age">관람 연령</Label>
          <Input
            id="event-age"
            placeholder="예) 전체관람가, 만 12세 이상"
            value={form.age_restriction ?? ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, age_restriction: e.target.value }))
            }
          />
        </div>
      </div>

      {/* 포스터 */}
      <div className="space-y-2">
        <Label>포스터 이미지</Label>
        <ImageUploader
          value={form.poster_url ?? ""}
          onChange={(url) => setForm((s) => ({ ...s, poster_url: url }))}
          folder="posters"
          placeholder="포스터 이미지"
        />
      </div>

      {/* 공지 */}
      <div className="space-y-2">
        <Label htmlFor="event-notice">공지사항</Label>
        <Textarea
          id="event-notice"
          placeholder="관람객에게 안내할 내용을 입력하세요."
          rows={4}
          value={form.notice_text ?? ""}
          onChange={(e) =>
            setForm((s) => ({ ...s, notice_text: e.target.value }))
          }
        />
      </div>

      <div className="flex items-center gap-2 rounded-md border border-border p-3 text-body-sm text-text-secondary">
        <CalendarDays className="h-4 w-4" />
        모든 날짜/시간은 KST 기준으로 표시됩니다.
      </div>
    </div>
  );
}

/** 이벤트 행의 아티스트 연결 상태를 배지로 표시 */
function ArtistLinkBadges({
  eventId,
  artistId,
  eventArtistsMap,
  artistMap,
}: {
  eventId: string;
  artistId: string | null;
  eventArtistsMap: Map<string, { artist_id: string; artist_name: string }[]>;
  artistMap: Map<string, string>;
}) {
  const ea = eventArtistsMap.get(eventId);

  // ✅ event_artists 테이블에 연결됨 — 초록 배지
  if (ea && ea.length > 0) {
    const display = ea.slice(0, 2);
    const extra = ea.length - 2;
    return (
      <div className="flex flex-wrap gap-1">
        {display.map((a) => (
          <Badge key={a.artist_id} variant="success">
            {a.artist_name}
          </Badge>
        ))}
        {extra > 0 && <Badge variant="outline">+{extra}명</Badge>}
      </div>
    );
  }

  // ⚠ 레거시 artist_id 필드만 연결 — 노란 배지
  const legacyName = artistId ? artistMap.get(artistId) : null;
  if (legacyName) {
    return (
      <Badge variant="warning" title="event_artists 미연결 (레거시 artist_id)">
        {legacyName}
      </Badge>
    );
  }

  // ❌ 미연결 — 빨간 배지
  return <Badge variant="danger">미연결</Badge>;
}
