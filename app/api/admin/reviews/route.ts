import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
  const star = url.searchParams.get("star")?.trim();
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = createClient();

  let query = supabase
    .from("concert_reviews")
    .select(
      "id, title, star_count, content, username, created_at, events(id, title, poster_url)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q) {
    query = query.or(`username.ilike.%${q}%,events.title.ilike.%${q}%`);
  }
  if (star) {
    query = query.eq("star_count", parseInt(star, 10));
  }

  const { data, count, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    meta: buildPaginationMeta(page, pageSize, count ?? 0),
  });
}
