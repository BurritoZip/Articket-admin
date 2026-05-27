import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { normalizeTitle, normalizeVenueName } from "@/lib/ingestion/normalize";
import { generateDedupKey } from "@/lib/ingestion/dedup";
import type { EventRow, OptionItem } from "@/types/event";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";

const VALID_STATUSES = ["upcoming", "on_sale", "ongoing", "ended"];

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status")?.trim();
  const missingField = url.searchParams.get("missing")?.trim();
  const duplicatesOnly = url.searchParams.get("duplicates") === "true";
  const noArtistLink = url.searchParams.get("no_artist_link") === "true";
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const VALID_MISSING = new Set([
    "artist_id",
    "venue_id",
    "poster_url",
    "end_date",
    "genre",
    "duration",
    "age_restriction",
    "ticket_open_date",
    "ticket_provider",
    "notice_text",
  ]);
  const NULL_ONLY = new Set([
    "artist_id",
    "venue_id",
    "end_date",
    "ticket_open_date",
  ]);

  const VALID_SORT = new Set(["title", "start_date", "status", "created_at"]);
  const sortBy = VALID_SORT.has(url.searchParams.get("sortBy") ?? "")
    ? (url.searchParams.get("sortBy") as string)
    : "start_date";
  const sortDir = url.searchParams.get("sortDir") === "asc" ? true : false;

  const supabase = createClient();

  let eventsQuery = supabase
    .from("events")
    .select(
      "id, title, artist_id, venue_id, poster_url, start_date, end_date, status, genre, duration, age_restriction, ticket_open_date, ticket_provider, notice_text, is_banner, has_timetable",
      { count: "exact" },
    )
    .order(sortBy, { ascending: sortDir });

  if (search) eventsQuery = eventsQuery.ilike("title", `%${search}%`);
  if (status && VALID_STATUSES.includes(status)) {
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

  // event_artists 미연결 이벤트 필터
  if (noArtistLink) {
    const { data: linkedRows } = await supabase
      .from("event_artists")
      .select("event_id");
    const linkedIds = Array.from(
      new Set((linkedRows ?? []).map((r) => r.event_id)),
    );
    if (linkedIds.length > 0) {
      eventsQuery = eventsQuery.not("id", "in", `(${linkedIds.join(",")})`);
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
        eventArtists: [],
        eventVenues: [],
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
        eventArtists: [],
        eventVenues: [],
        ...buildPaginationMeta(page, pageSize, 0),
        warning: "events 테이블이 아직 없습니다.",
      });
    }
    return NextResponse.json(
      { error: "list_failed", detail: eventsRes.error.message },
      { status: 400 },
    );
  }

  const eventIds = (eventsRes.data ?? []).map((e) => (e as { id: string }).id);

  const [eventArtistsRes, eventVenuesRes] = await Promise.all([
    eventIds.length > 0
      ? supabase
          .from("event_artists")
          .select("event_id, artist_id, artist_name, display_order")
          .in("event_id", eventIds)
          .order("display_order")
      : { data: [], error: null },
    eventIds.length > 0
      ? supabase
          .from("event_venues")
          .select("event_id, venue_id, display_order")
          .in("event_id", eventIds)
          .order("display_order")
      : { data: [], error: null },
  ]);

  const total = eventsRes.count ?? 0;

  return NextResponse.json({
    rows: (eventsRes.data ?? []) as EventRow[],
    artists: (artistsRes.data ?? []) as OptionItem[],
    venues: (venuesRes.data ?? []) as OptionItem[],
    // 테이블 미존재 시 빈 배열로 graceful degradation
    eventArtists: eventArtistsRes.error ? [] : (eventArtistsRes.data ?? []),
    eventVenues: eventVenuesRes.error ? [] : (eventVenuesRes.data ?? []),
    ...buildPaginationMeta(page, pageSize, total),
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Partial<EventRow> & {
    artist_ids?: string[];
    venue_ids?: string[];
  };

  const artistIds: string[] =
    body.artist_ids && body.artist_ids.length > 0
      ? body.artist_ids
      : body.artist_id
        ? [body.artist_id]
        : [];
  const venueIds: string[] =
    body.venue_ids && body.venue_ids.length > 0
      ? body.venue_ids
      : body.venue_id
        ? [body.venue_id]
        : [];

  if (
    !body.title?.trim() ||
    !body.start_date ||
    artistIds.length === 0 ||
    venueIds.length === 0
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

  const supabase = createServiceRoleClient();

  const normalizedTitleVal = normalizeTitle(body.title.trim());
  const startDateStr = (body.start_date as string).slice(0, 10);

  const { data: venueRow } = await supabase
    .from("venues")
    .select("name")
    .eq("id", venueIds[0])
    .maybeSingle();
  const normalizedVenueVal = normalizeVenueName(
    (venueRow as { name?: string } | null)?.name ?? null,
  );
  const dedupKey = generateDedupKey(
    normalizedTitleVal,
    normalizedVenueVal,
    startDateStr,
  );

  const { data: dupByKey } = await supabase
    .from("events")
    .select("id, title")
    .eq("dedup_key", dedupKey)
    .maybeSingle();
  const { data: dupByTitle } = !dupByKey
    ? await supabase
        .from("events")
        .select("id, title")
        .eq("normalized_title", normalizedTitleVal)
        .gte("start_date", startDateStr)
        .lt("start_date", `${startDateStr}T23:59:59`)
        .maybeSingle()
    : { data: null };
  const dup = dupByKey ?? dupByTitle;
  if (dup) {
    return NextResponse.json(
      {
        error: "duplicate_event",
        detail: `같은 제목+날짜 이벤트가 이미 존재합니다: "${(dup as { title: string }).title}"`,
      },
      { status: 409 },
    );
  }

  // Fetch artist names for event_artists
  const { data: artistRows } = await supabase
    .from("artists")
    .select("id, name")
    .in("id", artistIds);
  const artistNameMap = new Map(
    ((artistRows as { id: string; name: string }[] | null) ?? []).map((a) => [
      a.id,
      a.name,
    ]),
  );

  const { data: insertedEvent, error } = await supabase
    .from("events")
    .insert({
      title: body.title.trim(),
      normalized_title: normalizedTitleVal,
      dedup_key: dedupKey,
      artist_id: artistIds[0],
      venue_id: venueIds[0],
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
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "create_failed", detail: error.message },
      { status: 400 },
    );
  }

  const newEventId = (insertedEvent as { id: string }).id;

  // Insert event_artists
  await supabase.from("event_artists").insert(
    artistIds.map((aid, i) => ({
      event_id: newEventId,
      artist_id: aid,
      artist_name: artistNameMap.get(aid) ?? "",
      role: "lineup",
      display_order: i,
    })),
  );

  // Insert event_venues
  await supabase.from("event_venues").insert(
    venueIds.map((vid, i) => ({
      event_id: newEventId,
      venue_id: vid,
      display_order: i,
    })),
  );

  await Promise.all(artistIds.map(recomputeUpcomingCount));

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
