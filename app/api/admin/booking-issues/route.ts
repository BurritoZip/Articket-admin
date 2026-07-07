import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";

// 예매 링크 미연결 이슈 로그 조회 (iOS 에서 booking_url 없는 공연 예매 시도 시 기록됨)
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  // resolved=only 미해결(현재도 booking_url 없음) / all 전체
  const filter = url.searchParams.get("filter")?.trim() ?? "all";
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("event_booking_link_issues")
    .select(
      "id, event_id, event_title, reason, platform, app_user_id, created_at, events(id, title, booking_url)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q) {
    query = query.ilike("event_title", `%${q}%`);
  }

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 현재 booking_url 유무로 해결 여부 판정 (이후 채워졌으면 resolved)
  let rows = (data ?? []).map((r: Record<string, unknown>) => {
    const ev = r.events as { booking_url: string | null } | null;
    return { ...r, resolved: !!ev?.booking_url };
  });
  if (filter === "unresolved") {
    rows = rows.filter((r) => !r.resolved);
  }

  return NextResponse.json({
    data: rows,
    meta: buildPaginationMeta(page, pageSize, count ?? 0),
  });
}
