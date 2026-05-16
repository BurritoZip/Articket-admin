"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Clock, Music2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/Sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import type { TimetablePerformanceRow } from "@/types/timetable";
import type { EventRow } from "@/types/event";

type Props = {
  event: EventRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHasTimetableChange: () => void;
};

const EMPTY_FORM: Omit<
  TimetablePerformanceRow,
  "id" | "event_id" | "created_at"
> = {
  day_number: 1,
  date_string: "",
  start_time: "",
  end_time: "",
  artist_name: "",
  stage_name: "",
  genre: "",
};

export function TimetableSheet({
  event,
  open,
  onOpenChange,
  onHasTimetableChange,
}: Props) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const [editTarget, setEditTarget] =
    React.useState<TimetablePerformanceRow | null>(null);
  const [form, setForm] = React.useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-timetable", event?.id],
    queryFn: async () => {
      if (!event?.id) return { rows: [] as TimetablePerformanceRow[] };
      const res = await fetch(`/api/admin/timetable?event_id=${event.id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("타임테이블을 불러오지 못했습니다.");
      return res.json() as Promise<{ rows: TimetablePerformanceRow[] }>;
    },
    enabled: open && !!event?.id,
  });

  const rows = React.useMemo(() => data?.rows ?? [], [data]);

  const byDay = React.useMemo(() => {
    const map = new Map<number, TimetablePerformanceRow[]>();
    for (const row of rows) {
      const list = map.get(row.day_number) ?? [];
      list.push(row);
      map.set(row.day_number, list);
    }
    return map;
  }, [rows]);

  const refetch = () => {
    void queryClient.invalidateQueries({
      queryKey: ["admin-timetable", event?.id],
    });
  };

  const openAdd = () => {
    setForm({ ...EMPTY_FORM });
    setAddOpen(true);
  };

  const openEdit = (row: TimetablePerformanceRow) => {
    setEditTarget(row);
    setForm({
      day_number: row.day_number,
      date_string: row.date_string,
      start_time: row.start_time,
      end_time: row.end_time,
      artist_name: row.artist_name,
      stage_name: row.stage_name,
      genre: row.genre,
    });
  };

  const submitAdd = async () => {
    if (!event) return;
    if (
      !form.date_string ||
      !form.start_time ||
      !form.end_time ||
      !form.artist_name ||
      !form.stage_name
    ) {
      toast.error("필수 항목을 모두 입력하세요.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/timetable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, event_id: event.id }),
      });
      const json = (await res.json()) as { detail?: string };
      if (!res.ok) throw new Error(json.detail ?? "생성 실패");
      toast.success("공연이 추가되었습니다.");
      setAddOpen(false);
      refetch();
      if (!event.has_timetable) onHasTimetableChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/timetable/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json()) as { detail?: string };
      if (!res.ok) throw new Error(json.detail ?? "수정 실패");
      toast.success("수정되었습니다.");
      setEditTarget(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "수정 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("이 항목을 삭제할까요?")) return;
    const res = await fetch(`/api/admin/timetable/${id}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { detail?: string };
    if (!res.ok) {
      toast.error(json.detail ?? "삭제 실패");
      return;
    }
    toast.success("삭제되었습니다.");
    refetch();
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>타임테이블 관리</SheetTitle>
            <SheetDescription>
              {event?.title ?? ""} 공연의 타임테이블을 관리합니다.
            </SheetDescription>
          </SheetHeader>

          <div className="flex items-center justify-between pt-2">
            <p className="text-body-sm text-text-secondary">
              총 {rows.length}개 공연
            </p>
            <Button size="sm" onClick={openAdd}>
              <Plus className="mr-1 h-4 w-4" />
              공연 추가
            </Button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto py-2">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : byDay.size === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-surface-muted/40 py-12 text-center">
                <Music2 className="mx-auto mb-3 h-8 w-8 text-text-tertiary" />
                <p className="text-body text-text-secondary">
                  등록된 공연이 없습니다.
                </p>
              </div>
            ) : (
              Array.from(byDay.entries()).map(([day, perfs]) => (
                <div key={day}>
                  <h3 className="mb-3 text-label font-semibold text-text-primary">
                    DAY {day}{" "}
                    <span className="ml-1 text-caption font-normal text-text-tertiary">
                      {perfs[0]?.date_string}
                    </span>
                  </h3>
                  <div className="space-y-2">
                    {perfs.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 rounded-md border border-border bg-surface p-3"
                      >
                        <div className="flex min-w-[90px] items-center gap-1 text-caption text-text-tertiary">
                          <Clock className="h-3 w-3" />
                          {p.start_time}–{p.end_time}
                        </div>
                        <div className="flex-1">
                          <p className="text-body-sm font-medium text-text-primary">
                            {p.artist_name}
                          </p>
                          <p className="text-caption text-text-tertiary">
                            {p.stage_name}
                            {p.genre ? ` · ${p.genre}` : ""}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => openEdit(p)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="danger-weak"
                            onClick={() => void remove(p.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>공연 추가</DialogTitle>
            <DialogDescription>
              타임테이블에 공연을 추가합니다.
            </DialogDescription>
          </DialogHeader>
          <TimetableForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              취소
            </Button>
            <Button loading={submitting} onClick={() => void submitAdd()}>
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>공연 수정</DialogTitle>
            <DialogDescription>
              {editTarget?.artist_name} 공연 정보를 수정합니다.
            </DialogDescription>
          </DialogHeader>
          <TimetableForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              취소
            </Button>
            <Button loading={submitting} onClick={() => void submitEdit()}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type FormState = Omit<
  TimetablePerformanceRow,
  "id" | "event_id" | "created_at"
>;

const STAGE_OPTIONS = [
  "MAIN STAGE",
  "STAGE A",
  "STAGE B",
  "STAGE C",
  "STAGE D",
  "GREEN STAGE",
  "BLUE STAGE",
  "RED STAGE",
];

const GENRE_OPTIONS = [
  "K-POP",
  "POP",
  "R&B",
  "HIP-HOP",
  "ROCK",
  "INDIE",
  "EDM",
  "JAZZ",
  "BALLAD",
  "DANCE",
];

function TimetableForm({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  const dateInputValue = form.date_string
    ? form.date_string.replace(/\./g, "-")
    : "";

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const iso = e.target.value; // "2026-05-22"
    const formatted = iso.replace(/-/g, "."); // "2026.05.22"
    const day = form.day_number;
    setForm((s) => ({ ...s, date_string: formatted, day_number: day }));
  };

  return (
    <div className="grid gap-4 py-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>
            DAY <span className="text-red-500">*</span>
          </Label>
          <Select
            value={String(form.day_number)}
            onValueChange={(v) =>
              setForm((s) => ({ ...s, day_number: Number(v) }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="DAY 선택" />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  DAY {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>
            날짜 <span className="text-red-500">*</span>
          </Label>
          <Input
            type="date"
            value={dateInputValue}
            onChange={handleDateChange}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>
            시작 시간 <span className="text-red-500">*</span>
          </Label>
          <Input
            type="time"
            value={form.start_time}
            onChange={(e) =>
              setForm((s) => ({ ...s, start_time: e.target.value }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label>
            종료 시간 <span className="text-red-500">*</span>
          </Label>
          <Input
            type="time"
            value={form.end_time}
            onChange={(e) =>
              setForm((s) => ({ ...s, end_time: e.target.value }))
            }
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>
          아티스트명 <span className="text-red-500">*</span>
        </Label>
        <Input
          placeholder="아티스트 이름"
          value={form.artist_name}
          onChange={(e) =>
            setForm((s) => ({ ...s, artist_name: e.target.value }))
          }
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="stage-input">
            스테이지 <span className="text-red-500">*</span>
          </Label>
          <Input
            id="stage-input"
            list="stage-datalist"
            placeholder="STAGE A 또는 직접 입력"
            value={form.stage_name}
            onChange={(e) =>
              setForm((s) => ({ ...s, stage_name: e.target.value }))
            }
          />
          <datalist id="stage-datalist">
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="space-y-2">
          <Label>장르</Label>
          <Select
            value={form.genre || "__none__"}
            onValueChange={(v) =>
              setForm((s) => ({ ...s, genre: v === "__none__" ? "" : v }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="장르 선택" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">선택 안 함</SelectItem>
              {GENRE_OPTIONS.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
