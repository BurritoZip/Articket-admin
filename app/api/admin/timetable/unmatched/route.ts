import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { withErrorHandler } from "@/lib/api-handler";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";

// 타임테이블 임포트 시 기존 아티스트 리스트에 매칭 안 된 이름 로그 조회
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status")?.trim() ?? "unresolved";
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("timetable_unmatched_artists")
    .select(
      "id, event_id, event_title, artist_name, stage_name, day_number, source, is_resolved, created_at, events(id, title)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q) query = query.ilike("artist_name", `%${q}%`);
  if (status === "unresolved") query = query.eq("is_resolved", false);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data: data ?? [],
    meta: buildPaginationMeta(page, pageSize, count ?? 0),
  });
}

// 미매칭 로그 해결 표시 (운영자가 별칭 추가/신규 생성/무시 후 처리 완료)
export const PATCH = withErrorHandler(async (request: Request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    id?: string;
    is_resolved?: boolean;
  };
  if (!body.id || typeof body.is_resolved !== "boolean") {
    return NextResponse.json(
      { error: "id 와 is_resolved(boolean) 필요" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("timetable_unmatched_artists")
    .update({ is_resolved: body.is_resolved })
    .eq("id", body.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
