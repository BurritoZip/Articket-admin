"use client";

import {
  ADMIN_PAGE_SIZE_OPTIONS,
  type AdminPageSize,
} from "@/lib/admin-pagination";
import { Button } from "@/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";

type AdminListPaginationProps = {
  page: number;
  totalPages: number;
  pageSize: AdminPageSize;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: AdminPageSize) => void;
  /** 현재 페이지에 표시 중인 행 수 */
  rowCountOnPage: number;
};

export function AdminListPagination({
  page,
  totalPages,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  rowCountOnPage,
}: AdminListPaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + rowCountOnPage;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <p className="text-caption text-text-tertiary">
        전체 {total.toLocaleString("ko-KR")}건 · {from.toLocaleString("ko-KR")}–
        {to.toLocaleString("ko-KR")} 표시
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-sm text-text-secondary whitespace-nowrap">
          페이지당
        </span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v) as AdminPageSize)}
        >
          <SelectTrigger className="h-9 w-[88px]" aria-label="페이지당 개수">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ADMIN_PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}개
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          이전
        </Button>
        <span className="min-w-[5.5rem] text-center text-body-sm text-text-secondary tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          다음
        </Button>
      </div>
    </div>
  );
}
