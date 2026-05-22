"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
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
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import {
  DEFAULT_ADMIN_PAGE_SIZE,
  type AdminListPagination as PaginationMeta,
  type AdminPageSize,
} from "@/lib/admin-pagination";

interface ReviewRow {
  id: string;
  title: string | null;
  star_count: number;
  content: string | null;
  username: string | null;
  created_at: string;
  events: { id: string; title: string; poster_url: string | null } | null;
}

interface ReviewsResponse {
  data: ReviewRow[];
  meta: PaginationMeta;
}

function StarBadge({ count }: { count: number }) {
  const filled = "★".repeat(count);
  const empty = "☆".repeat(5 - count);
  return (
    <span className="text-yellow-500 tabular-nums">
      {filled}
      <span className="text-text-tertiary">{empty}</span>
    </span>
  );
}

export function ReviewsPageClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [starFilter, setStarFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<AdminPageSize>(
    DEFAULT_ADMIN_PAGE_SIZE,
  );
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const queryKey = [
    "admin-reviews",
    { q: debouncedSearch, star: starFilter, page, pageSize },
  ];

  const { data, isLoading } = useQuery<ReviewsResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (starFilter !== "all") params.set("star", starFilter);
      const res = await fetch(`/api/admin/reviews?${params}`);
      if (!res.ok) throw new Error("fetch failed");
      return res.json() as Promise<ReviewsResponse>;
    },
  });

  const rows = data?.data ?? [];
  const meta = data?.meta;

  const confirmDelete = async () => {
    if (!deleteId) return;
    const res = await fetch(`/api/admin/reviews/${deleteId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("삭제에 실패했습니다.");
    } else {
      toast.success("리뷰가 삭제되었습니다.");
      void queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
    }
    setDeleteId(null);
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="공연명 또는 작성자 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="md:max-w-sm"
          />
          <Select
            value={starFilter}
            onValueChange={(v) => {
              setStarFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="md:w-[160px]">
              <SelectValue placeholder="별점" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 별점</SelectItem>
              {[5, 4, 3, 2, 1].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {"★".repeat(n)} ({n}점)
                </SelectItem>
              ))}
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
              표시할 리뷰가 없습니다.
            </p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>공연명</TableHead>
                  <TableHead>작성자</TableHead>
                  <TableHead>별점</TableHead>
                  <TableHead>제목</TableHead>
                  <TableHead>작성일</TableHead>
                  <TableHead className="w-[80px]">작업</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <React.Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-surface-hover"
                      onClick={() =>
                        setExpandedId((prev) =>
                          prev === row.id ? null : row.id,
                        )
                      }
                    >
                      <TableCell className="font-medium">
                        {row.events?.title ?? "-"}
                      </TableCell>
                      <TableCell>{row.username ?? "-"}</TableCell>
                      <TableCell>
                        <StarBadge count={row.star_count} />
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-text-secondary">
                        {row.title ?? "-"}
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {new Date(row.created_at).toLocaleDateString("ko-KR")}
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-text-tertiary hover:text-text-primary"
                            onClick={() =>
                              setExpandedId((prev) =>
                                prev === row.id ? null : row.id,
                              )
                            }
                            title="내용 펼치기"
                          >
                            {expandedId === row.id ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteId(row.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedId === row.id && (
                      <TableRow className="bg-surface-muted/30 hover:bg-surface-muted/30">
                        <TableCell colSpan={6} className="py-3">
                          <div className="rounded-md border border-border bg-surface p-4 text-body-sm text-text-secondary">
                            {row.content?.trim() ? (
                              <p className="whitespace-pre-wrap leading-relaxed">
                                {row.content}
                              </p>
                            ) : (
                              <p className="italic text-text-tertiary">
                                내용이 없습니다.
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>

            {meta && (
              <AdminListPagination
                page={meta.page}
                pageSize={pageSize}
                totalPages={meta.totalPages}
                total={meta.total}
                rowCountOnPage={rows.length}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
              />
            )}
          </>
        )}
      </div>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>리뷰를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              삭제된 리뷰는 복구할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
