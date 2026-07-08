import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";

// 이벤트 필드별 변경 이력(event_change_logs) — 무엇이 어떻게 바뀌었는지 조회.
// 크롤/보강 파이프라인이 upsert 시 old→new 를 기록한다(지금까지 admin 미노출이던 데이터).
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const field = url.searchParams.get("field")?.trim();
  // hideNoop=1: 값이 실제로 안 바뀐(포맷만 다른) 항목 숨김
  const hideNoop = url.searchParams.get("hideNoop") === "1";
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("event_change_logs")
    .select(
      "id, event_id, field_name, old_value, new_value, changed_at, events(title)",
      { count: "exact" },
    )
    .order("changed_at", { ascending: false })
    .range(from, to);

  if (field) query = query.eq("field_name", field);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = (data ?? []).map((r: Record<string, unknown>) => {
    const ev = r.events as { title: string } | null;
    return { ...r, event_title: ev?.title ?? null } as Record<string, unknown>;
  });

  // 제목 검색은 조인 컬럼이라 후처리(현재 페이지 한정) — 정확 필터는 field 로.
  if (q) {
    const lc = q.toLowerCase();
    rows = rows.filter((r) =>
      String(r.event_title ?? "")
        .toLowerCase()
        .includes(lc),
    );
  }
  if (hideNoop) {
    rows = rows.filter(
      (r) => normalize(r.old_value) !== normalize(r.new_value),
    );
  }

  return NextResponse.json({
    data: rows,
    meta: buildPaginationMeta(page, pageSize, count ?? 0),
  });
}

// 날짜 등 포맷만 다른 값(2026-05-16T00:00:00+00:00 vs 2026-05-16)을 같은 값으로 취급
function normalize(v: unknown): string {
  const s = String(v ?? "").trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : s;
}
