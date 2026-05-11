import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import type { ArtistRow } from "@/types/artist";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const missingField = url.searchParams.get("missing")?.trim();
  const duplicatesOnly = url.searchParams.get("duplicates") === "true";
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const VALID_MISSING = new Set([
    "avatar_url",
    "occupation",
    "birth_date",
    "birth_place",
    "related",
  ]);
  const NULL_ONLY = new Set(["birth_date"]);

  const supabase = createClient();
  let query = supabase
    .from("artists")
    .select(
      "id, name, avatar_url, followers_count, upcoming_event_count, occupation, birth_date, birth_place, related",
      { count: "exact" },
    )
    .order("name", { ascending: true });

  if (q) query = query.ilike("name", `%${q}%`);

  if (missingField && VALID_MISSING.has(missingField)) {
    if (NULL_ONLY.has(missingField)) {
      query = query.is(missingField, null);
    } else {
      query = query.or(`${missingField}.is.null,${missingField}.eq.`);
    }
  }

  if (duplicatesOnly) {
    const { data: allNames } = await supabase.from("artists").select("name");
    const nameCounts: Record<string, number> = {};
    for (const { name } of allNames ?? []) {
      nameCounts[name] = (nameCounts[name] ?? 0) + 1;
    }
    const duplicateNames = Object.keys(nameCounts).filter(
      (n) => nameCounts[n] > 1,
    );
    if (duplicateNames.length === 0) {
      return NextResponse.json({
        rows: [],
        ...buildPaginationMeta(page, pageSize, 0),
      });
    }
    query = query.in("name", duplicateNames);
  }

  const res = await query.range(from, to);
  if (res.error) {
    if ((res.error as { code?: string }).code === "42P01") {
      return NextResponse.json({
        rows: [],
        ...buildPaginationMeta(page, pageSize, 0),
        warning: "artists 테이블이 아직 없습니다.",
      });
    }
    return NextResponse.json(
      { error: "list_failed", detail: res.error.message },
      { status: 400 },
    );
  }

  const total = res.count ?? 0;
  return NextResponse.json({
    rows: (res.data ?? []) as ArtistRow[],
    ...buildPaginationMeta(page, pageSize, total),
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Partial<ArtistRow>;
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const supabase = createClient();
  const { error } = await supabase.from("artists").insert({
    name: body.name.trim(),
    avatar_url: body.avatar_url ?? null,
    followers_count: body.followers_count ?? 0,
    upcoming_event_count: body.upcoming_event_count ?? 0,
    occupation: body.occupation ?? null,
    birth_date: body.birth_date ?? null,
    birth_place: body.birth_place ?? null,
    related: body.related ?? null,
  });

  if (error) {
    return NextResponse.json(
      { error: "create_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
