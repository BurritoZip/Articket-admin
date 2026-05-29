import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { validateArtist } from "@/lib/ingestion/schemas";
import type { ArtistRow } from "@/types/artist";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";

const ARTIST_SELECT =
  "id, name, avatar_url, followers_count, upcoming_event_count, occupation, birth_date, birth_place, related, label, country, sns_links";

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
    "label",
    "country",
    "birth_date",
    "birth_place",
    "related",
  ]);
  const NULL_ONLY = new Set(["birth_date"]);
  const VALID_SORT = new Set([
    "name",
    "followers_count",
    "upcoming_event_count",
    "created_at",
  ]);
  const sortBy = VALID_SORT.has(url.searchParams.get("sortBy") ?? "")
    ? (url.searchParams.get("sortBy") as string)
    : "name";
  const sortDir = url.searchParams.get("sortDir") === "desc" ? false : true;

  const supabase = createClient();
  let query = supabase
    .from("artists")
    .select(ARTIST_SELECT, { count: "exact" })
    .order(sortBy, { ascending: sortDir });

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
  const artistIds = (res.data ?? []).map((a) => (a as { id: string }).id);

  // 팔로워 수 + event_artists 기반 연결 공연 수 병렬 조회
  let followMap: Record<string, number> = {};
  let linkedEventCountMap: Record<string, number> = {};

  if (artistIds.length > 0) {
    const [followsRes, eventArtistsRes] = await Promise.all([
      supabase
        .from("user_artist_followings")
        .select("artist_id")
        .in("artist_id", artistIds),
      supabase
        .from("event_artists")
        .select("artist_id")
        .in("artist_id", artistIds),
    ]);

    for (const row of followsRes.data ?? []) {
      const id = (row as { artist_id: string }).artist_id;
      followMap[id] = (followMap[id] ?? 0) + 1;
    }
    for (const row of eventArtistsRes.data ?? []) {
      const id = (row as { artist_id: string }).artist_id;
      linkedEventCountMap[id] = (linkedEventCountMap[id] ?? 0) + 1;
    }
  }

  const rows = (res.data ?? []).map((artist) => ({
    ...artist,
    followers_count: followMap[(artist as { id: string }).id] ?? 0,
    linked_event_count: linkedEventCountMap[(artist as { id: string }).id] ?? 0,
  }));

  return NextResponse.json({
    rows: rows as ArtistRow[],
    ...buildPaginationMeta(page, pageSize, total),
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Partial<ArtistRow>;

  const validation = validateArtist({
    name: body.name,
    avatar_url: body.avatar_url,
  });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "validation_failed", details: validation.errors },
      { status: 422 },
    );
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("artists").insert({
    name: validation.data.name.trim(),
    avatar_url: body.avatar_url ?? null,
    followers_count: body.followers_count ?? 0,
    upcoming_event_count: body.upcoming_event_count ?? 0,
    occupation: body.occupation ?? null,
    birth_date: body.birth_date ?? null,
    birth_place: body.birth_place ?? null,
    related: body.related ?? null,
    label: body.label ?? null,
    country: body.country ?? null,
    sns_links: body.sns_links ?? {},
  });

  if (error) {
    return NextResponse.json(
      { error: "create_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
