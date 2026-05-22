import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import type { EventRow, OptionItem } from "@/types/event";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status")?.trim();
  const missingField = url.searchParams.get("missing")?.trim();
  const duplicatesOnly = url.searchParams.get("duplicates") === "true";
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const VALID_MISSING = new Set([
    "poster_url",
    "end_date",
    "genre",
    "duration",
    "age_restriction",
    "ticket_open_date",
    "ticket_provider",
    "notice_text",
  ]);
  const NULL_ONLY = new Set(["end_date", "ticket_open_date"]);

  const supabase = createClient();

  let eventsQuery = supabase
    .from("events")
    .select(
      "id, title, artist_id, venue_id, poster_url, start_date, end_date, status, genre, duration, age_restriction, ticket_open_date, ticket_provider, notice_text, is_banner, has_timetable",
      { count: "exact" },
    )
    .order("start_date", { ascending: false });

  if (search) eventsQuery = eventsQuery.ilike("title", `%${search}%`);
  if (status && ["upcoming", "on_sale", "ended"].includes(status)) {
    eventsQuery = eventsQuery.eq("status", status);
  }

  if (missingField && VALID_MISSING.has(missingField)) {
    if (NULL_ONLY.has(missingField)) {
      eventsQuery = eventsQuery.is(missingField, null);
    } else {
      eventsQuery = eventsQuery.or(
        `${missingField}.is.null,${missingField}.eq.`,
      );
    }
  }

  if (duplicatesOnly) {
    const { data: allTitles } = await supabase.from("events").select("title");
    const titleCounts: Record<string, number> = {};
    for (const { title } of allTitles ?? []) {
      titleCounts[title] = (titleCounts[title] ?? 0) + 1;
    }
    const duplicateTitles = Object.keys(titleCounts).filter(
      (t) => titleCounts[t] > 1,
    );
    if (duplicateTitles.length === 0) {
      const [artistsRes, venuesRes] = await Promise.all([
        supabase.from("artists").select("id, name").order("name"),
        supabase.from("venues").select("id, name").order("name"),
      ]);
      return NextResponse.json({
        rows: [],
        artists: artistsRes.data ?? [],
        venues: venuesRes.data ?? [],
        ...buildPaginationMeta(page, pageSize, 0),
      });
    }
    eventsQuery = eventsQuery.in("title", duplicateTitles);
  }

  const [eventsRes, artistsRes, venuesRes] = await Promise.all([
    eventsQuery.range(from, to),
    supabase
      .from("artists")
      .select("id, name")
      .order("name", { ascending: true }),
    supabase
      .from("venues")
      .select("id, name")
      .order("name", { ascending: true }),
  ]);

  if (eventsRes.error) {
    if ((eventsRes.error as { code?: string }).code === "42P01") {
      return NextResponse.json({
        rows: [],
        artists: [],
        venues: [],
        ...buildPaginationMeta(page, pageSize, 0),
        warning: "events 테이블이 아직 없습니다.",
      });
    }
    return NextResponse.json(
      { error: "list_failed", detail: eventsRes.error.message },
      { status: 400 },
    );
  }

  const total = eventsRes.count ?? 0;

  return NextResponse.json({
    rows: (eventsRes.data ?? []) as EventRow[],
    artists: (artistsRes.data ?? []) as OptionItem[],
    venues: (venuesRes.data ?? []) as OptionItem[],
    ...buildPaginationMeta(page, pageSize, total),
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Partial<EventRow>;
  if (
    !body.title?.trim() ||
    !body.start_date ||
    !body.artist_id ||
    !body.venue_id
  ) {
    return NextResponse.json(
      { error: "missing_required_fields" },
      { status: 400 },
    );
  }

  if (body.end_date && new Date(body.end_date) < new Date(body.start_date)) {
    return NextResponse.json(
      {
        error: "invalid_date_range",
        detail: "종료일은 시작일보다 빠를 수 없습니다.",
      },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const { error } = await supabase.from("events").insert({
    title: body.title.trim(),
    artist_id: body.artist_id,
    venue_id: body.venue_id,
    poster_url: body.poster_url ?? null,
    start_date: body.start_date,
    end_date: body.end_date ?? null,
    status: body.status ?? "upcoming",
    genre: body.genre ?? null,
    duration: body.duration ?? null,
    age_restriction: body.age_restriction ?? null,
    ticket_open_date: body.ticket_open_date ?? null,
    ticket_provider: body.ticket_provider ?? null,
    notice_text: body.notice_text ?? null,
    is_banner: body.is_banner ?? false,
    has_timetable: body.has_timetable ?? false,
  });

  if (error) {
    return NextResponse.json(
      { error: "create_failed", detail: error.message },
      { status: 400 },
    );
  }

  if (body.artist_id) {
    await recomputeUpcomingCount(body.artist_id);
  }

  return NextResponse.json({ ok: true });
}

async function recomputeUpcomingCount(artistId: string) {
  const supabase = createServiceRoleClient();
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("artist_id", artistId)
    .not("status", "in", "(ended,cancelled)");
  await supabase
    .from("artists")
    .update({ upcoming_event_count: count ?? 0 })
    .eq("id", artistId);
}
