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
      "id, seat, delivery_type, booked_at, status, events(id, title, poster_url, start_date, end_date, venues(name))",
      { count: "exact" }
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    meta: buildPaginationMeta(page, pageSize, count ?? 0),
  });
}
