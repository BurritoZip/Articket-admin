"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Music, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/Avatar";
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
import { Skeleton } from "@/components/ui/Skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import type {
  AlbumRow,
  ArtistRow,
  MusicVideoRow,
  SnsLinks,
} from "@/types/artist";
import { Badge } from "@/components/ui/Badge";
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
import { AvatarImage } from "@/components/ui/Avatar";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import { ImageUploader } from "@/components/admin/ImageUploader";
import {
  DEFAULT_ADMIN_PAGE_SIZE,
  type AdminPageSize,
} from "@/lib/admin-pagination";
import {
  CompletenessFilterBar,
  type CompletenessStats,
} from "@/components/admin/CompletenessFilterBar";
import { MissingFieldChips } from "@/components/admin/MissingFieldChips";
import { ARTIST_FIELDS } from "@/lib/completeness";
import { ArtistDedupSheet } from "@/components/admin/ArtistDedupSheet";
import {
  SortableTableHead,
  type SortDir,
} from "@/components/admin/SortableTableHead";

type ArtistDetailResponse = {
  artist: ArtistRow;
  albums: AlbumRow[];
  videos: MusicVideoRow[];
};

export function ArtistsPageClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [fromUrlOpen, setFromUrlOpen] = React.useState(false);
  const [fromUrlInput, setFromUrlInput] = React.useState("");
  const [fromUrlLoading, setFromUrlLoading] = React.useState(false);

  const emptyArtistForm: Partial<ArtistRow> = {
    name: "",
    occupation: "",
    avatar_url: "",
    birth_date: "",
    birth_place: "",
    related: "",
    label: "",
    country: "",
    sns_links: {},
  };
  const [form, setForm] = React.useState<Partial<ArtistRow>>(emptyArtistForm);

  const [editingArtist, setEditingArtist] = React.useState<ArtistRow | null>(
    null,
  );
  const [detailArtist, setDetailArtist] = React.useState<ArtistRow | null>(
    null,
  );
  const [albums, setAlbums] = React.useState<Array<Partial<AlbumRow>>>([]);
  const [videos, setVideos] = React.useState<Array<Partial<MusicVideoRow>>>([]);
  const [detailAlbums, setDetailAlbums] = React.useState<AlbumRow[]>([]);
  const [detailVideos, setDetailVideos] = React.useState<MusicVideoRow[]>([]);
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
  const [enriching, setEnriching] = React.useState(false);
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
      "admin-artists",
      search,
      page,
      pageSize,
      missingFilter,
      duplicatesFilter,
      sortBy,
      sortDir,
    ],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (search.trim()) q.set("q", search.trim());
      q.set("page", String(page));
      q.set("pageSize", String(pageSize));
      q.set("sortBy", sortBy);
      q.set("sortDir", sortDir);
      if (missingFilter) q.set("missing", missingFilter);
      if (duplicatesFilter) q.set("duplicates", "true");
      const res = await fetch(`/api/admin/artists?${q.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        rows?: ArtistRow[];
        warning?: string;
        detail?: string;
        total?: number;
        totalPages?: number;
      };
      if (!res.ok) throw new Error(json.detail ?? "아티스트 목록 조회 실패");
      if (json.warning) toast.message("안내", { description: json.warning });
      return {
        rows: json.rows ?? [],
        total: json.total ?? 0,
        totalPages: json.totalPages ?? 1,
      };
    },
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-artists-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/artists/stats", {
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

  const openCreate = () => {
    setForm({ ...emptyArtistForm });
    setCreateOpen(true);
  };

  const importArtistFromUrl = async () => {
    const url = fromUrlInput.trim();
    if (!url) return;
    setFromUrlLoading(true);
    try {
      const res = await fetch("/api/admin/artists/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = (await res.json()) as {
        action?: string;
        artist?: { name: string };
        detail?: string;
      };
      if (!res.ok) throw new Error(json.detail ?? "불러오기 실패");
      const label = json.action === "created" ? "추가" : "업데이트";
      toast.success(`아티스트가 ${label}되었습니다.`, {
        description: json.artist?.name,
      });
      setFromUrlOpen(false);
      setFromUrlInput("");
      await refetch();
    } catch (e) {
      toast.error("가져오기 실패", {
        description: e instanceof Error ? e.message : "알 수 없는 오류",
      });
    } finally {
      setFromUrlLoading(false);
    }
  };

  const fetchArtistDetail = async (artistId: string) => {
    const res = await fetch(`/api/admin/artists/${artistId}`, {
      cache: "no-store",
    });
    const json = (await res.json()) as ArtistDetailResponse & {
      detail?: string;
    };
    if (!res.ok) {
      throw new Error(json.detail ?? "상세 조회 실패");
    }
    return json;
  };

  const openEdit = async (artist: ArtistRow) => {
    try {
      const json = await fetchArtistDetail(artist.id);
      setEditingArtist(json.artist);
      setForm(json.artist);
      setAlbums(json.albums);
      setVideos(json.videos);
      setEditOpen(true);
    } catch (error) {
      toast.error("상세 조회 실패", {
        description: error instanceof Error ? error.message : "오류",
      });
    }
  };

  const openDetail = async (artist: ArtistRow) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const json = await fetchArtistDetail(artist.id);
      setDetailArtist(json.artist);
      setDetailAlbums(json.albums);
      setDetailVideos(json.videos);
    } catch (error) {
      toast.error("상세 조회 실패", {
        description: error instanceof Error ? error.message : "오류",
      });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const submitCreate = async () => {
    if (!form.name?.trim()) {
      toast.error("아티스트 이름은 필수입니다.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json()) as { detail?: string };
      if (!res.ok) throw new Error(json.detail ?? "생성 실패");
      toast.success("아티스트가 추가되었습니다.");
      setCreateOpen(false);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["admin-artists-list"] });
    } catch (error) {
      toast.error("생성 실패", {
        description: error instanceof Error ? error.message : "알 수 없는 오류",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async () => {
    if (!editingArtist) return;
    if (!form.name?.trim()) {
      toast.error("아티스트 이름은 필수입니다.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/artists/${editingArtist.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artist: form,
          albums,
          videos,
        }),
      });
      const json = (await res.json()) as { detail?: string };
      if (!res.ok) throw new Error(json.detail ?? "수정 실패");
      toast.success("아티스트가 수정되었습니다.");
      setEditOpen(false);
      setEditingArtist(null);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["admin-artists-list"] });
    } catch (error) {
      toast.error("수정 실패", {
        description: error instanceof Error ? error.message : "알 수 없는 오류",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = (allRows: { id: string }[]) =>
    setSelectedIds(
      selectedIds.size === allRows.length
        ? new Set()
        : new Set(allRows.map((r) => r.id)),
    );

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    setBulkDeleting(true);
    try {
      const res = await fetch("/api/admin/artists/bulk", {
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
      void refetch();
    } finally {
      setBulkDeleting(false);
      setBulkDeleteConfirmOpen(false);
    }
  };

  const removeArtist = (id: string) => setDeleteId(id);

  const confirmRemove = async () => {
    if (!deleteId) return;
    const res = await fetch(`/api/admin/artists/${deleteId}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { detail?: string };
    setDeleteId(null);
    if (!res.ok) {
      toast.error("삭제 실패", { description: json.detail ?? "삭제 실패" });
      return;
    }
    toast.success("아티스트가 삭제되었습니다.");
    const result = await refetch();
    if (result.data?.rows.length === 0 && page > 1) setPage((p) => p - 1);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumb={[
          { label: "관리", href: "/admin/dashboard" },
          { label: "아티스트" },
        ]}
        title="아티스트 관리"
        description="아티스트 기본 정보와 앨범/뮤직비디오를 함께 관리합니다."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={enriching}
              onClick={async () => {
                setEnriching(true);
                try {
                  const res = await fetch("/api/admin/artists/enrich", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      mode: "queue",
                      filter: {
                        missing: [
                          "avatar_url",
                          "occupation",
                          "label",
                          "name_en",
                        ],
                      },
                    }),
                  });
                  const json = (await res.json()) as {
                    queued?: number;
                    error?: string;
                  };
                  if (!res.ok)
                    throw new Error(json.error ?? "보강 큐 등록 실패");
                  toast.success(`보강 큐 등록 완료`, {
                    description: `${json.queued ?? 0}명의 아티스트가 보강 대기열에 추가됐습니다.`,
                  });
                  queryClient.invalidateQueries({
                    queryKey: ["admin-artists-stats"],
                  });
                } catch (e) {
                  toast.error("보강 큐 등록 실패", {
                    description:
                      e instanceof Error ? e.message : "알 수 없는 오류",
                  });
                } finally {
                  setEnriching(false);
                }
              }}
            >
              {enriching ? "등록 중..." : "✨ 일괄 보강"}
              {(stats as CompletenessStats | null)?.enrichmentPending ? (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-4 px-1 text-[10px]"
                >
                  {(stats as CompletenessStats).enrichmentPending}
                </Badge>
              ) : null}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDedupOpen(true)}
            >
              🔀 중복 검토
              {(
                stats as
                  | (CompletenessStats & { duplicateCount?: number })
                  | null
              )?.duplicateCount ? (
                <Badge variant="danger" className="ml-1.5 h-4 px-1 text-[10px]">
                  {
                    (stats as CompletenessStats & { duplicateCount: number })
                      .duplicateCount
                  }
                </Badge>
              ) : null}
            </Button>
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
              아티스트 추가
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-h3">아티스트 목록</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <Input
            placeholder="아티스트명 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <CompletenessFilterBar
            fields={ARTIST_FIELDS}
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
                표시할 아티스트가 없습니다.
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
                        onChange={() => toggleAll(list)}
                      />
                    </TableHead>
                    <TableHead>아바타</TableHead>
                    <SortableTableHead
                      field="name"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    >
                      이름
                    </SortableTableHead>
                    <TableHead>소속사</TableHead>
                    <TableHead>직업</TableHead>
                    <SortableTableHead
                      field="followers_count"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    >
                      팔로워
                    </SortableTableHead>
                    <SortableTableHead
                      field="upcoming_event_count"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                      className="whitespace-nowrap"
                    >
                      연결 공연
                    </SortableTableHead>
                    <TableHead>완성도</TableHead>
                    <TableHead className="w-[220px]">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((row) => (
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
                        <Avatar className="h-9 w-9">
                          <AvatarImage
                            src={row.avatar_url ?? ""}
                            alt={row.name}
                          />
                          <AvatarFallback>
                            {row.name.slice(0, 1)}
                          </AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.label ?? "-"}</TableCell>
                      <TableCell>{row.occupation ?? "-"}</TableCell>
                      <TableCell>{row.followers_count ?? 0}</TableCell>
                      <TableCell>
                        {(row.linked_event_count ?? 0) > 0 ? (
                          <Badge variant="success">
                            <Music className="mr-1 h-3 w-3" />
                            {row.linked_event_count}
                          </Badge>
                        ) : (
                          <Badge variant="outline">0</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <MissingFieldChips
                          row={row as Record<string, unknown>}
                          fields={ARTIST_FIELDS}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void openDetail(row)}
                          >
                            상세
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void openEdit(row)}
                          >
                            <Pencil className="mr-1 h-4 w-4" />
                            편집
                          </Button>
                          <Button
                            size="icon"
                            variant="danger-weak"
                            onClick={() => void removeArtist(row.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
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
            <DialogTitle>아티스트 추가</DialogTitle>
            <DialogDescription>기본 정보를 입력하세요.</DialogDescription>
          </DialogHeader>
          <ArtistForm form={form} setForm={setForm} />
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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>아티스트 수정</DialogTitle>
            <DialogDescription>
              기본 정보와 연결 콘텐츠를 함께 관리합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
            <ArtistForm form={form} setForm={setForm} />
            <NestedListEditor
              title="앨범"
              rows={albums}
              setRows={setAlbums}
              isVideo={false}
            />
            <NestedListEditor
              title="뮤직비디오"
              rows={videos}
              setRows={setVideos}
              isVideo
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditOpen(false);
                setEditingArtist(null);
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
          {detailLoading ? (
            <div className="space-y-2 py-6">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : detailArtist ? (
            <>
              <SheetHeader>
                <SheetTitle>{detailArtist.name}</SheetTitle>
                <SheetDescription>
                  {detailArtist.occupation ?? "-"}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto py-4 text-body-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailItem label="이름" value={detailArtist.name} />
                  <DetailItem
                    label="직업"
                    value={detailArtist.occupation ?? "-"}
                  />
                  <DetailItem
                    label="소속사"
                    value={detailArtist.label ?? "-"}
                  />
                  <DetailItem
                    label="국가"
                    value={detailArtist.country ?? "-"}
                  />
                  <DetailItem
                    label="팔로워 수"
                    value={String(detailArtist.followers_count ?? 0)}
                  />
                  <DetailItem
                    label="연결 공연 수"
                    value={String(detailArtist.linked_event_count ?? 0)}
                  />
                  <DetailItem
                    label="생년월일"
                    value={detailArtist.birth_date ?? "-"}
                  />
                  <DetailItem
                    label="출생지"
                    value={detailArtist.birth_place ?? "-"}
                  />
                  <DetailItem
                    label="관련 아티스트"
                    value={detailArtist.related ?? "-"}
                  />
                </div>
                {/* SNS 링크 */}
                {detailArtist.sns_links &&
                  Object.values(detailArtist.sns_links).some(Boolean) && (
                    <div>
                      <p className="mb-2 text-caption font-semibold text-text-tertiary">
                        SNS / 스트리밍 링크
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {detailArtist.sns_links.spotify && (
                          <a
                            href={detailArtist.sns_links.spotify}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Badge variant="secondary">Spotify</Badge>
                          </a>
                        )}
                        {detailArtist.sns_links.apple_music && (
                          <a
                            href={detailArtist.sns_links.apple_music}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Badge variant="secondary">Apple Music</Badge>
                          </a>
                        )}
                        {detailArtist.sns_links.youtube && (
                          <a
                            href={detailArtist.sns_links.youtube}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Badge variant="secondary">YouTube</Badge>
                          </a>
                        )}
                        {detailArtist.sns_links.instagram && (
                          <a
                            href={detailArtist.sns_links.instagram}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Badge variant="secondary">Instagram</Badge>
                          </a>
                        )}
                        {detailArtist.sns_links.twitter && (
                          <a
                            href={detailArtist.sns_links.twitter}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Badge variant="secondary">X (Twitter)</Badge>
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                {detailArtist.avatar_url && (
                  <div>
                    <p className="mb-2 text-caption font-semibold text-text-tertiary">
                      아바타
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={detailArtist.avatar_url}
                      alt={detailArtist.name}
                      className="h-20 w-20 rounded-full border border-border object-cover"
                    />
                  </div>
                )}
                <div>
                  <p className="mb-2 text-caption font-semibold text-text-tertiary">
                    앨범 ({detailAlbums.length})
                  </p>
                  <div className="space-y-2">
                    {detailAlbums.length === 0 ? (
                      <p className="text-caption text-text-tertiary">
                        등록된 앨범이 없습니다.
                      </p>
                    ) : (
                      detailAlbums.map((a) => (
                        <div
                          key={a.id}
                          className="rounded-md border border-border p-3"
                        >
                          <p className="font-medium text-text-primary">
                            {a.title}
                          </p>
                          <p className="text-caption text-text-secondary">
                            발매연도: {a.released_year ?? "-"}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-caption font-semibold text-text-tertiary">
                    뮤직비디오 ({detailVideos.length})
                  </p>
                  <div className="space-y-2">
                    {detailVideos.length === 0 ? (
                      <p className="text-caption text-text-tertiary">
                        등록된 영상이 없습니다.
                      </p>
                    ) : (
                      detailVideos.map((v) => (
                        <div
                          key={v.id}
                          className="rounded-md border border-border p-3"
                        >
                          <p className="font-medium text-text-primary">
                            {v.title}
                          </p>
                          <p className="text-caption text-text-secondary">
                            업로드일: {v.uploaded_at ?? "-"}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setDetailOpen(false)}>
                  닫기
                </Button>
                <Button
                  variant="secondary"
                  disabled={enriching}
                  onClick={async () => {
                    if (!detailArtist) return;
                    setEnriching(true);
                    try {
                      const res = await fetch("/api/admin/artists/enrich", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          mode: "single",
                          artistId: detailArtist.id,
                        }),
                      });
                      const json = (await res.json()) as {
                        delta?: { addedFields: string[]; skipped: boolean };
                      };
                      if (json.delta?.skipped) {
                        toast.info("보강할 데이터가 없습니다", {
                          description: "모든 필드가 이미 채워져 있습니다.",
                        });
                      } else if ((json.delta?.addedFields?.length ?? 0) > 0) {
                        toast.success("보강 완료", {
                          description: `${json.delta!.addedFields.join(", ")} 필드가 채워졌습니다.`,
                        });
                        void refetch();
                      } else {
                        toast.warning("보강 결과 없음", {
                          description:
                            "외부 소스에서 데이터를 찾지 못했습니다.",
                        });
                      }
                    } catch {
                      toast.error("보강 실패");
                    } finally {
                      setEnriching(false);
                    }
                  }}
                >
                  {enriching ? "보강 중..." : "✨ 외부 소스 보강"}
                </Button>
                <Button
                  onClick={() => {
                    setDetailOpen(false);
                    setEditingArtist(detailArtist);
                    setForm(detailArtist);
                    setAlbums(detailAlbums);
                    setVideos(detailVideos);
                    setEditOpen(true);
                  }}
                >
                  편집하기
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>아티스트 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 아티스트를 삭제하면 복구할 수 없습니다. 계속하시겠습니까?
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
              선택한 아티스트 {selectedIds.size}건이 모두 삭제됩니다. 되돌릴 수
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

      {/* URL로 아티스트 추가 */}
      <Dialog open={fromUrlOpen} onOpenChange={setFromUrlOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>URL로 아티스트 추가</DialogTitle>
            <DialogDescription>
              StagePick 아티스트 상세 URL을 붙여넣으면 정보를 자동으로
              가져옵니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="artist-from-url-input">아티스트 URL</Label>
            <Input
              id="artist-from-url-input"
              placeholder="https://www.stagepick.co.kr/artists/detail/..."
              value={fromUrlInput}
              onChange={(e) => setFromUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void importArtistFromUrl();
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
              onClick={() => void importArtistFromUrl()}
            >
              가져오기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 중복 검토 Sheet */}
      <ArtistDedupSheet open={dedupOpen} onClose={() => setDedupOpen(false)} />
    </div>
  );
}

function ArtistForm({
  form,
  setForm,
}: {
  form: Partial<ArtistRow>;
  setForm: React.Dispatch<React.SetStateAction<Partial<ArtistRow>>>;
}) {
  return (
    <div className="grid gap-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="artist-name">이름</Label>
        <Input
          id="artist-name"
          value={form.name ?? ""}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="artist-occupation">직업</Label>
          <Input
            id="artist-occupation"
            value={form.occupation ?? ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, occupation: e.target.value }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="artist-related">관련 아티스트</Label>
          <Input
            id="artist-related"
            value={form.related ?? ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, related: e.target.value }))
            }
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="artist-label">소속사</Label>
          <Input
            id="artist-label"
            placeholder="예) SM Entertainment"
            value={form.label ?? ""}
            onChange={(e) => setForm((s) => ({ ...s, label: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="artist-country">국가</Label>
          <Input
            id="artist-country"
            placeholder="예) KR, US, JP"
            value={form.country ?? ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, country: e.target.value }))
            }
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="artist-birth-date">생년월일</Label>
          <Input
            id="artist-birth-date"
            type="date"
            value={form.birth_date ?? ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, birth_date: e.target.value }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="artist-birth-place">출생지</Label>
          <Input
            id="artist-birth-place"
            value={form.birth_place ?? ""}
            onChange={(e) =>
              setForm((s) => ({ ...s, birth_place: e.target.value }))
            }
          />
        </div>
      </div>

      {/* SNS / 스트리밍 링크 */}
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-body-sm font-semibold text-text-primary">
          SNS / 스트리밍 링크
        </p>
        {(
          [
            {
              key: "spotify",
              label: "Spotify",
              placeholder: "https://open.spotify.com/artist/...",
            },
            {
              key: "apple_music",
              label: "Apple Music",
              placeholder: "https://music.apple.com/...",
            },
            {
              key: "youtube",
              label: "YouTube",
              placeholder: "https://www.youtube.com/@...",
            },
            {
              key: "instagram",
              label: "Instagram",
              placeholder: "https://www.instagram.com/...",
            },
            {
              key: "twitter",
              label: "X (Twitter)",
              placeholder: "https://x.com/...",
            },
          ] as { key: keyof SnsLinks; label: string; placeholder: string }[]
        ).map(({ key, label, placeholder }) => (
          <div key={key} className="flex items-center gap-2">
            <Label className="w-24 shrink-0 text-caption text-text-secondary">
              {label}
            </Label>
            <Input
              placeholder={placeholder}
              value={form.sns_links?.[key] ?? ""}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  sns_links: { ...(s.sns_links ?? {}), [key]: e.target.value },
                }))
              }
            />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label>아바타 이미지</Label>
        <ImageUploader
          value={form.avatar_url ?? ""}
          onChange={(url) => setForm((s) => ({ ...s, avatar_url: url }))}
          folder="avatars"
          placeholder="아바타 이미지"
        />
      </div>
    </div>
  );
}

function NestedListEditor({
  title,
  rows,
  setRows,
  isVideo,
}: {
  title: string;
  rows: Array<Partial<AlbumRow> | Partial<MusicVideoRow>>;
  setRows: React.Dispatch<
    React.SetStateAction<Array<Partial<AlbumRow> | Partial<MusicVideoRow>>>
  >;
  isVideo: boolean;
}) {
  const addRow = () => {
    setRows((prev) => [...prev, { title: "" }]);
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-body-sm font-semibold text-text-primary">
          {title}
        </h3>
        <Button size="sm" variant="secondary" onClick={addRow}>
          항목 추가
        </Button>
      </div>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-caption text-text-tertiary">항목이 없습니다.</p>
        ) : (
          rows.map((row, idx) => (
            <div
              key={idx}
              className="space-y-2 rounded-md border border-border p-3"
            >
              <div className="flex items-center gap-2">
                <Input
                  placeholder="제목"
                  className="flex-1"
                  value={row.title ?? ""}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === idx ? { ...r, title: e.target.value } : r,
                      ),
                    )
                  }
                />
                <Input
                  placeholder={isVideo ? "업로드일(YYYY-MM-DD)" : "발매연도"}
                  className="w-36"
                  type={isVideo ? "date" : "text"}
                  value={
                    (isVideo
                      ? (row as Partial<MusicVideoRow>).uploaded_at
                      : (row as Partial<AlbumRow>).released_year) ?? ""
                  }
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === idx
                          ? isVideo
                            ? { ...r, uploaded_at: e.target.value }
                            : { ...r, released_year: e.target.value }
                          : r,
                      ),
                    )
                  }
                />
                <Button
                  size="icon"
                  variant="danger-weak"
                  onClick={() =>
                    setRows((prev) => prev.filter((_, i) => i !== idx))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <ImageUploader
                value={
                  (isVideo
                    ? (row as Partial<MusicVideoRow>).thumbnail_url
                    : (row as Partial<AlbumRow>).cover_url) ?? ""
                }
                onChange={(url) =>
                  setRows((prev) =>
                    prev.map((r, i) =>
                      i === idx
                        ? isVideo
                          ? { ...r, thumbnail_url: url }
                          : { ...r, cover_url: url }
                        : r,
                    ),
                  )
                }
                folder={isVideo ? "thumbnails" : "covers"}
                placeholder={isVideo ? "썸네일" : "앨범 커버"}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="mt-1 break-all text-text-primary">{value}</p>
    </div>
  );
}
