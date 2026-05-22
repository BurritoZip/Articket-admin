"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Clock, Music2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";
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
  artist_id: null,
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
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState("");
  const [replaceExisting, setReplaceExisting] = React.useState(false);
  const [sourceLoading, setSourceLoading] = React.useState(false);
  const [sourceIssues, setSourceIssues] = React.useState<string[]>([]);
  const [importResult, setImportResult] = React.useState<{
    parsedCount: number;
    insertedCount: number;
    skippedCount: number;
    issues: Array<{ line: string; reason: string }>;
  } | null>(null);
  const [editTarget, setEditTarget] =
    React.useState<TimetablePerformanceRow | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const { data: artistsData } = useQuery({
    queryKey: ["admin-artists-list"],
    queryFn: async () => {
      const res = await fetch("/api/admin/artists?pageSize=200", {
        cache: "no-store",
      });
      if (!res.ok) return { rows: [] as { id: string; name: string }[] };
      return res.json() as Promise<{ rows: { id: string; name: string }[] }>;
    },
    staleTime: 0,
  });
  const artists = React.useMemo(() => artistsData?.rows ?? [], [artistsData]);

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

  const openImport = () => {
    setImportText("");
    setReplaceExisting(false);
    setSourceIssues([]);
    setImportResult(null);
    setImportOpen(true);
  };

  const openEdit = (row: TimetablePerformanceRow) => {
    setEditTarget(row);
    setForm({
      artist_id: row.artist_id,
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

  const submitImport = async () => {
    if (!event) return;
    setImporting(true);
    try {
      const res = await fetch("/api/admin/timetable/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          text: importText,
          replaceExisting,
          autoFetchSource: true,
        }),
      });
      const json = (await res.json()) as {
        result?: {
          parsedCount: number;
          insertedCount: number;
          skippedCount: number;
          issues: Array<{ line: string; reason: string }>;
        };
        source?: { text?: string; issues?: string[] };
        detail?: string;
      };
      if (!res.ok || !json.result) {
        throw new Error(json.detail ?? "타임테이블 자동 입력 실패");
      }
      if (json.source?.issues?.length) setSourceIssues(json.source.issues);
      if (!importText.trim() && json.source?.text) setImportText(json.source.text);
      setImportResult(json.result);
      toast.success(`${json.result.insertedCount}개 출연을 자동 추가했습니다.`);
      refetch();
      onHasTimetableChange();
      void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "자동 입력 실패");
    } finally {
      setImporting(false);
    }
  };

  const loadSourceText = async () => {
    if (!event) return;
    setSourceLoading(true);
    setSourceIssues([]);
    try {
      const res = await fetch(`/api/admin/timetable/source?event_id=${event.id}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        source?: { text: string; issues: string[]; assetUrls?: string[] };
        detail?: string;
      };
      if (!res.ok || !json.source) {
        throw new Error(json.detail ?? "원본 추출 실패");
      }
      setImportText(json.source.text);
      setSourceIssues(json.source.issues ?? []);
      if (json.source.text.trim()) {
        toast.success("원본에서 타임테이블 후보 텍스트를 가져왔습니다.");
      } else {
        toast.error("원본에서 바로 파싱 가능한 텍스트를 찾지 못했습니다.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "원본 추출 실패");
    } finally {
      setSourceLoading(false);
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

  const confirmRemove = async () => {
    if (!deleteId) return;
    const idToDelete = deleteId;
    setDeleteId(null);
    const res = await fetch(`/api/admin/timetable/${idToDelete}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { detail?: string };
    if (!res.ok) {
      toast.error(json.detail ?? "삭제 실패");
      return;
    }
    toast.success("삭제되었습니다.");
    await queryClient.invalidateQueries({
      queryKey: ["admin-timetable", event?.id],
    });
    const remaining = rows.filter((r) => r.id !== idToDelete);
    if (remaining.length === 0 && event) {
      await fetch(`/api/admin/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ has_timetable: false }),
      });
      void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    }
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
              총 {rows.length}개 출연
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={openImport}>
                <Wand2 className="mr-1 h-4 w-4" />
                자동 입력
              </Button>
              <Button size="sm" onClick={openAdd}>
                <Plus className="mr-1 h-4 w-4" />
                공연 추가
              </Button>
            </div>
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
                            onClick={() => setDeleteId(p.id)}
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
          <TimetableForm form={form} setForm={setForm} artists={artists} />
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

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>타임테이블 자동 입력</DialogTitle>
            <DialogDescription>
              원본 상세 페이지에서 타임테이블 후보를 먼저 가져오고, 필요하면 직접 보정한 뒤 출연 항목을 생성합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex justify-end">
              <Button
                type="button"
                variant="secondary"
                loading={sourceLoading}
                onClick={() => void loadSourceText()}
              >
                원본에서 가져오기
              </Button>
            </div>
            <Textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={12}
              placeholder={`DAY 1 2026.05.22 MAIN STAGE\n14:00-14:40 아티스트A\n15:00-15:40 아티스트B @ SUB STAGE\nDAY 2\n13:20 ~ 14:00 아티스트C`}
            />
            <div className="flex items-center gap-2">
              <input
                id="replace-existing-timetable"
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="replace-existing-timetable">
                기존 타임테이블을 지우고 새로 생성
              </Label>
            </div>
            {sourceIssues.length > 0 && (
              <div className="rounded-md border border-border bg-surface-muted p-3 text-caption text-text-secondary">
                {sourceIssues.slice(0, 4).map((issue, index) => (
                  <p key={`${issue}-${index}`}>{issue}</p>
                ))}
              </div>
            )}
            {importResult && (
              <div className="rounded-md border border-border bg-surface-muted p-3 text-body-sm">
                <p>
                  파싱 {importResult.parsedCount}개 · 추가{" "}
                  {importResult.insertedCount}개 · 실패{" "}
                  {importResult.skippedCount + importResult.issues.length}개
                </p>
                {importResult.issues.length > 0 && (
                  <div className="mt-2 max-h-28 overflow-y-auto text-caption text-text-secondary">
                    {importResult.issues.slice(0, 8).map((issue, index) => (
                      <p key={`${issue.line}-${index}`}>
                        {issue.line} · {issue.reason}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              닫기
            </Button>
            <Button loading={importing} onClick={() => void submitImport()}>
              자동 생성
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
          <TimetableForm form={form} setForm={setForm} artists={artists} />
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

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>출연 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 출연 항목을 삭제하면 복구할 수 없습니다. 계속하시겠습니까?
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

function SearchDropdown({
  value,
  onChange,
  options,
  placeholder,
  onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  placeholder: string;
  onSelect: (label: string, value: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => {
    const q = value.toLowerCase();
    if (!q) return options.slice(0, 20);
    return options
      .filter((o) => o.label.toLowerCase().includes(q))
      .slice(0, 20);
  }, [value, options]);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-elevation3">
          {filtered.map((o) => (
            <li
              key={o.value}
              className="cursor-pointer px-3 py-2 text-body-sm hover:bg-surface-muted"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(o.label, o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimetableForm({
  form,
  setForm,
  artists,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  artists: { id: string; name: string }[];
}) {
  const dateInputValue = form.date_string
    ? form.date_string.replace(/\./g, "-")
    : "";

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const iso = e.target.value;
    setForm((s) => ({ ...s, date_string: iso.replace(/-/g, ".") }));
  };

  const artistOptions = React.useMemo(
    () => artists.map((a) => ({ label: a.name, value: a.id })),
    [artists],
  );

  const stageOptions = React.useMemo(
    () => STAGE_OPTIONS.map((s) => ({ label: s, value: s })),
    [],
  );

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
          아티스트 <span className="text-red-500">*</span>
        </Label>
        <SearchDropdown
          value={form.artist_name}
          onChange={(v) =>
            setForm((s) => ({ ...s, artist_name: v, artist_id: null }))
          }
          options={artistOptions}
          placeholder="아티스트명 검색"
          onSelect={(label, value) =>
            setForm((s) => ({ ...s, artist_name: label, artist_id: value }))
          }
        />
        {form.artist_id && (
          <p className="text-caption text-text-tertiary">DB 아티스트 연결됨</p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>
            스테이지 <span className="text-red-500">*</span>
          </Label>
          <SearchDropdown
            value={form.stage_name}
            onChange={(v) => setForm((s) => ({ ...s, stage_name: v }))}
            options={stageOptions}
            placeholder="스테이지 검색 또는 입력"
            onSelect={(label) => setForm((s) => ({ ...s, stage_name: label }))}
          />
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
