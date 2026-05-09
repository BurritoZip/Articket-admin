"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
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
import { formatKst } from "@/lib/format-kst";
import type { EventRow, EventStatus, OptionItem } from "@/types/event";

type EventQueryResponse = {
  rows: EventRow[];
  artists: OptionItem[];
  venues: OptionItem[];
  warning?: string;
};

const STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: "예정",
  on_sale: "예매중",
  ended: "종료",
};

export function EventsPageClient() {
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const [editingEvent, setEditingEvent] = React.useState<EventRow | null>(null);
  const [detailEvent, setDetailEvent] = React.useState<EventRow | null>(null);

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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-events", search, statusFilter],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (search.trim()) q.set("q", search.trim());
      if (statusFilter !== "all") q.set("status", statusFilter);

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

  const rows = React.useMemo(() => data?.rows ?? [], [data]);
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

  const removeEvent = async (id: string) => {
    if (!window.confirm("이 공연을 삭제할까요?")) return;
    const res = await fetch(`/api/admin/events/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { detail?: string };
    if (!res.ok) {
      toast.error("삭제 실패", { description: json.detail ?? "삭제 실패" });
      return;
    }
    toast.success("공연이 삭제되었습니다.");
    await refetch();
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>공연명</TableHead>
                  <TableHead>아티스트</TableHead>
                  <TableHead>공연장</TableHead>
                  <TableHead>시작일</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>배너</TableHead>
                  <TableHead className="w-[160px]">작업</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.title}</TableCell>
                    <TableCell>{artistMap.get(row.artist_id) ?? "-"}</TableCell>
                    <TableCell>{venueMap.get(row.venue_id) ?? "-"}</TableCell>
                    <TableCell>{formatKst(row.start_date)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "on_sale"
                            ? "success"
                            : row.status === "upcoming"
                              ? "warning"
                              : "outline"
                        }
                      >
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.is_banner ? "ON" : "OFF"}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDetail(row)}
                        >
                          상세
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openEdit(row)}
                        >
                          <Pencil className="mr-1 h-4 w-4" />
                          편집
                        </Button>
                        <Button
                          size="icon"
                          variant="danger-weak"
                          onClick={() => void removeEvent(row.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
      <div className="flex items-center gap-2 rounded-md border border-border p-3 text-body-sm text-text-secondary">
        <CalendarDays className="h-4 w-4" />
        모든 날짜/시간은 KST 기준으로 표시됩니다.
      </div>
    </div>
  );
}
