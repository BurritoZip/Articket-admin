"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Pencil,
  Clock,
  Music2,
  Wand2,
  ImagePlus,
  X,
} from "lucide-react";
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
  const [autoLoading, setAutoLoading] = React.useState(false);
  const [autoSourceUrl, setAutoSourceUrl] = React.useState("");
  const [autoResult, setAutoResult] = React.useState<{
    inserted: number;
    artists: string[];
    days: number;
  } | null>(null);
  const [manualOpen, setManualOpen] = React.useState(false);
  const [editTarget, setEditTarget] =
    React.useState<TimetablePerformanceRow | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  // Image import state
  type ParsedPerf = {
    artist_name: string;
    stage_name: string;
    start_time: string;
    end_time: string;
    day_number: number;
    date_string: string;
  };
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(
    null,
  );
  const [imageParsed, setImageParsed] = React.useState<ParsedPerf[] | null>(
    null,
  );
  const [imageSelected, setImageSelected] = React.useState<Set<number>>(
    new Set(),
  );
  const [imageParsing, setImageParsing] = React.useState(false);
  const [imageCommitting, setImageCommitting] = React.useState(false);
  const [imageOpen, setImageOpen] = React.useState(false);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

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
    setAutoResult(null);
    setAutoSourceUrl("");
    setManualOpen(false);
    setImageOpen(false);
    setImageFile(null);
    setImagePreviewUrl(null);
    setImageParsed(null);
    setImageSelected(new Set());
    setImportOpen(true);
  };

  const handleImageFile = (file: File) => {
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    setImageParsed(null);
    setImageSelected(new Set());
  };

  const submitImageParse = async () => {
    if (!event || !imageFile) return;
    setImageParsing(true);
    setImageParsed(null);
    try {
      const fd = new FormData();
      fd.append("image", imageFile);
      if (event.start_date)
        fd.append("start_date", event.start_date.slice(0, 10));
      if (event.end_date) fd.append("end_date", event.end_date.slice(0, 10));
      const res = await fetch("/api/admin/timetable/from-image", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        performances?: ParsedPerf[];
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.detail ?? json.error ?? "이미지 파싱 실패");
      }
      const perfs = json.performances ?? [];
      setImageParsed(perfs);
      setImageSelected(new Set(perfs.map((_, i) => i)));
      toast.success(
        `${perfs.length}개 공연 정보를 인식했습니다. 확인 후 저장하세요.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "이미지 분석 실패");
    } finally {
      setImageParsing(false);
    }
  };

  const submitImageCommit = async () => {
    if (!event || !imageParsed) return;
    const selected = imageParsed.filter((_, i) => imageSelected.has(i));
    if (selected.length === 0) {
      toast.error("저장할 항목을 선택하세요.");
      return;
    }
    setImageCommitting(true);
    try {
      const res = await fetch("/api/admin/timetable/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          replaceExisting,
          performances: selected,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        inserted?: number;
        errors?: string[];
        unmatched?: string[];
        detail?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.detail ?? "저장 실패");
      }
      toast.success(`${json.inserted}개 공연이 타임테이블에 저장되었습니다.`);
      const unmatched = json.unmatched ?? [];
      if (unmatched.length > 0) {
        toast.warning(
          `기존 아티스트에 없는 ${unmatched.length}명은 미매칭 로그로 분리되었습니다: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? " 외" : ""}. 앱 에러/미매칭 로그에서 검토하세요.`,
          { duration: 8000 },
        );
      }
      setImageParsed(null);
      setImageFile(null);
      setImagePreviewUrl(null);
      setImportOpen(false);
      refetch();
      onHasTimetableChange();
      void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setImageCommitting(false);
    }
  };

  const submitAutoImport = async () => {
    if (!event) return;
    setAutoLoading(true);
    setAutoResult(null);
    try {
      const res = await fetch("/api/admin/timetable/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          replaceExisting,
          ...(autoSourceUrl.trim() ? { source_url: autoSourceUrl.trim() } : {}),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        inserted?: number;
        artists?: string[];
        days?: number;
        reason?: string;
        detail?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.detail ?? "아티스트 정보를 찾지 못했습니다.");
      }
      setAutoResult({
        inserted: json.inserted ?? 0,
        artists: json.artists ?? [],
        days: json.days ?? 1,
      });
      toast.success(
        `${json.inserted}명 아티스트 타임테이블 생성 완료 (${json.days}일 구성)`,
      );
      refetch();
      onHasTimetableChange();
      void queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "자동 생성 실패");
    } finally {
      setAutoLoading(false);
    }
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
          unmatched?: string[];
        };
        source?: { text?: string; issues?: string[] };
        detail?: string;
      };
      if (!res.ok || !json.result) {
        throw new Error(json.detail ?? "타임테이블 자동 입력 실패");
      }
      if (json.source?.issues?.length) setSourceIssues(json.source.issues);
      if (!importText.trim() && json.source?.text)
        setImportText(json.source.text);
      setImportResult(json.result);
      toast.success(`${json.result.insertedCount}개 출연을 자동 추가했습니다.`);
      const unmatched = json.result.unmatched ?? [];
      if (unmatched.length > 0) {
        toast.warning(
          `기존 아티스트에 없는 ${unmatched.length}명은 미매칭 로그로 분리되었습니다: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? " 외" : ""}. 미매칭 로그에서 검토하세요.`,
          { duration: 8000 },
        );
      }
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
      const res = await fetch(
        `/api/admin/timetable/source?event_id=${event.id}`,
        {
          cache: "no-store",
        },
      );
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
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>타임테이블 자동화</DialogTitle>
            <DialogDescription>
              StagePick URL 또는 타임테이블 이미지로 공연 정보를 자동으로
              가져옵니다.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 space-y-4 overflow-y-auto py-2">
            {/* StagePick URL 직접 입력 */}
            <div className="space-y-1">
              <Label htmlFor="auto-source-url">
                StagePick URL{" "}
                <span className="text-caption text-text-secondary">
                  (크롤 데이터 없을 때 직접 입력)
                </span>
              </Label>
              <Input
                id="auto-source-url"
                placeholder="https://www.stagepick.co.kr/performances/detail/12345"
                value={autoSourceUrl}
                onChange={(e) => setAutoSourceUrl(e.target.value)}
              />
            </div>

            {/* 기존 항목 교체 옵션 */}
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

            {/* 자동 생성 결과 */}
            {autoResult && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-body-sm text-green-800">
                <p className="font-medium">
                  ✅ {autoResult.inserted}명 아티스트 · {autoResult.days}일 구성
                </p>
                <p className="mt-1 text-caption text-green-700">
                  {autoResult.artists.slice(0, 8).join(", ")}
                  {autoResult.artists.length > 8
                    ? ` 외 ${autoResult.artists.length - 8}명`
                    : ""}
                </p>
              </div>
            )}

            {/* 이미지로 가져오기 (접기/펼치기) */}
            <div>
              <button
                type="button"
                onClick={() => setImageOpen((v) => !v)}
                className="text-caption text-text-secondary underline underline-offset-2"
              >
                {imageOpen
                  ? "▲ 이미지 업로드 닫기"
                  : "▼ 이미지로 타임테이블 가져오기"}
              </button>
              {imageOpen && (
                <div className="mt-3 space-y-3">
                  {/* Drop zone */}
                  <div
                    className="relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-surface-muted/40 p-6 text-center transition-colors hover:border-primary/50 hover:bg-surface-muted"
                    onClick={() => imageInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f) handleImageFile(f);
                    }}
                  >
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleImageFile(f);
                      }}
                    />
                    {imagePreviewUrl ? (
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imagePreviewUrl}
                          alt="타임테이블 미리보기"
                          className="max-h-48 max-w-full rounded object-contain"
                        />
                        <button
                          type="button"
                          className="absolute -right-2 -top-2 rounded-full bg-surface p-0.5 shadow-elevation1"
                          onClick={(e) => {
                            e.stopPropagation();
                            setImageFile(null);
                            setImagePreviewUrl(null);
                            setImageParsed(null);
                            setImageSelected(new Set());
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <ImagePlus className="mb-2 h-8 w-8 text-text-tertiary" />
                        <p className="text-body-sm text-text-secondary">
                          이미지를 여기에 드래그하거나 클릭해서 선택
                        </p>
                        <p className="mt-1 text-caption text-text-tertiary">
                          PNG, JPG, WEBP 지원
                        </p>
                      </>
                    )}
                  </div>

                  {imageFile && !imageParsed && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={imageParsing}
                      onClick={() => void submitImageParse()}
                    >
                      <Wand2 className="mr-1 h-4 w-4" />
                      {imageParsing ? "AI 분석 중..." : "이미지 분석하기"}
                    </Button>
                  )}

                  {/* 파싱 결과 미리보기 */}
                  {imageParsed && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-body-sm font-medium">
                          {imageParsed.length}개 공연 인식됨 ·{" "}
                          <span className="text-text-secondary">
                            {imageSelected.size}개 선택됨
                          </span>
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="text-caption text-text-secondary underline underline-offset-2"
                            onClick={() =>
                              setImageSelected(
                                new Set(imageParsed.map((_, i) => i)),
                              )
                            }
                          >
                            전체 선택
                          </button>
                          <button
                            type="button"
                            className="text-caption text-text-secondary underline underline-offset-2"
                            onClick={() => setImageSelected(new Set())}
                          >
                            전체 해제
                          </button>
                        </div>
                      </div>
                      <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                        <table className="w-full text-caption">
                          <thead className="sticky top-0 bg-surface-muted">
                            <tr>
                              <th className="p-2 text-left font-medium">
                                선택
                              </th>
                              <th className="p-2 text-left font-medium">
                                아티스트
                              </th>
                              <th className="p-2 text-left font-medium">
                                시간
                              </th>
                              <th className="p-2 text-left font-medium">
                                스테이지
                              </th>
                              <th className="p-2 text-left font-medium">DAY</th>
                            </tr>
                          </thead>
                          <tbody>
                            {imageParsed.map((p, i) => (
                              <tr
                                key={i}
                                className={`border-t border-border ${imageSelected.has(i) ? "" : "opacity-40"}`}
                              >
                                <td className="p-2">
                                  <input
                                    type="checkbox"
                                    checked={imageSelected.has(i)}
                                    onChange={() => {
                                      setImageSelected((prev) => {
                                        const next = new Set(prev);
                                        next.has(i)
                                          ? next.delete(i)
                                          : next.add(i);
                                        return next;
                                      });
                                    }}
                                    className="h-3.5 w-3.5"
                                  />
                                </td>
                                <td className="p-2 font-medium">
                                  {p.artist_name}
                                </td>
                                <td className="p-2 text-text-secondary">
                                  {p.start_time || "—"}
                                  {p.end_time ? `–${p.end_time}` : ""}
                                </td>
                                <td className="p-2 text-text-secondary">
                                  {p.stage_name || "—"}
                                </td>
                                <td className="p-2 text-text-secondary">
                                  {p.day_number}
                                  {p.date_string ? ` (${p.date_string})` : ""}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Button
                        size="sm"
                        loading={imageCommitting}
                        onClick={() => void submitImageCommit()}
                        disabled={imageSelected.size === 0}
                      >
                        {imageSelected.size}개 저장하기
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 수동 입력 (접기/펼치기) */}
            <div>
              <button
                type="button"
                onClick={() => setManualOpen((v) => !v)}
                className="text-caption text-text-secondary underline underline-offset-2"
              >
                {manualOpen ? "▲ 수동 입력 닫기" : "▼ 시간 직접 입력하기"}
              </button>
              {manualOpen && (
                <div className="mt-3 space-y-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={sourceLoading}
                    onClick={() => void loadSourceText()}
                  >
                    원본에서 텍스트 가져오기
                  </Button>
                  <Textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    rows={10}
                    placeholder={`DAY 1 2026.05.22 MAIN STAGE\n14:00-14:40 아티스트A\n15:00-15:40 아티스트B @ SUB STAGE\nDAY 2\n13:20 ~ 14:00 아티스트C`}
                  />
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
                        {importResult.skippedCount + importResult.issues.length}
                        개
                      </p>
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={importing}
                    onClick={() => void submitImport()}
                  >
                    텍스트로 생성
                  </Button>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              닫기
            </Button>
            <Button
              loading={autoLoading}
              onClick={() => void submitAutoImport()}
            >
              <Wand2 className="mr-1 h-4 w-4" />
              아티스트 자동 생성
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
