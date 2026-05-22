import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status")?.trim();
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("user_bookings")
    .select(
      "id, seat, delivery_type, booked_at, status, user_id, user_profiles!user_bookings_user_id_fkey(display_name), events(id, title, start_date, end_date, venues(name))",
      { count: "exact" },
    )
    .order("booked_at", { ascending: false })
    .range(from, to);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }
  if (q) {
    query = query.ilike("events.title", `%${q}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    // FK 힌트가 맞지 않으면 이름 없이 재시도
    let fallbackQuery = supabase
      .from("user_bookings")
      .select(
        "id, seat, delivery_type, booked_at, status, user_id, events(id, title, start_date, end_date, venues(name))",
        { count: "exact" },
      )
      .order("booked_at", { ascending: false })
      .range(from, to);

    if (status && status !== "all")
      fallbackQuery = fallbackQuery.eq("status", status);
    if (q) fallbackQuery = fallbackQuery.ilike("events.title", `%${q}%`);

    const fallback = await fallbackQuery;
    if (fallback.error)
      return NextResponse.json(
        { error: fallback.error.message },
        { status: 500 },
      );

    // user_profiles를 별도로 enrichment
    const userIds = Array.from(
      new Set(
        (fallback.data ?? [])
          .map((r: Record<string, unknown>) => r.user_id as string)
          .filter(Boolean),
      ),
    );
    const profileMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("id, display_name")
        .in("id", userIds);
      for (const p of profiles ?? []) {
        profileMap.set(
          (p as { id: string; display_name: string | null }).id,
          (p as { id: string; display_name: string | null }).display_name ??
            "-",
        );
      }
    }

    const enriched = (fallback.data ?? []).map(
      (r: Record<string, unknown>) => ({
        ...r,
        booker_name: profileMap.get(r.user_id as string) ?? "-",
      }),
    );

    return NextResponse.json({
      data: enriched,
      meta: buildPaginationMeta(page, pageSize, fallback.count ?? 0),
    });
  }

  const enriched = (data ?? []).map((r: Record<string, unknown>) => {
    const profile = r.user_profiles as { display_name: string | null } | null;
    return {
      ...r,
      booker_name: profile?.display_name ?? "-",
    };
  });

  return NextResponse.json({
    data: enriched,
    meta: buildPaginationMeta(page, pageSize, count ?? 0),
  });
}
