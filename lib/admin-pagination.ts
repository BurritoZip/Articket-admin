/** 관리자 목록 API·화면 공통 페이지네이션 */

export const ADMIN_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export type AdminPageSize = (typeof ADMIN_PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_ADMIN_PAGE_SIZE: AdminPageSize = 20;

export function clampAdminPageSize(n: number): AdminPageSize {
  if (ADMIN_PAGE_SIZE_OPTIONS.includes(n as AdminPageSize)) {
    return n as AdminPageSize;
  }
  return DEFAULT_ADMIN_PAGE_SIZE;
}

export function parseAdminPagination(searchParams: URLSearchParams) {
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const raw = parseInt(
    searchParams.get("pageSize") ?? String(DEFAULT_ADMIN_PAGE_SIZE),
    10,
  );
  const pageSize = clampAdminPageSize(
    Number.isFinite(raw) ? raw : DEFAULT_ADMIN_PAGE_SIZE,
  );
  return { page, pageSize };
}

export type AdminListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): AdminListPagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page, pageSize, total, totalPages };
}
