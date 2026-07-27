import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { normalizeTitle, normalizeVenueName } from "@/lib/ingestion/normalize";
import { generateDedupKey } from "@/lib/ingestion/dedup";
import { URL_RE } from "@/lib/data-quality/patterns";
import { recomputeUpcomingCount } from "@/lib/db/recompute-upcoming";
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
  // hidden=true → 숨긴 이벤트만(관리/복원용). 기본은 숨김 제외(관리자 목록 ≈ 앱 노출).
  const hiddenOnly = url.searchParams.get("hidden") === "true";
  // 끝난 공연(ended)은 기본 숨김 — 데이터는 보존(아티스트 과거공연 이력),
  // 목록엔 최신만 노출. include_ended=true 또는 status=ended 명시 시 표시.
  const includeEnded = url.searchParams.get("include_ended") === "true";
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
      "id, title, artist_id, venue_id, poster_url, start_date, end_date, status, genre, duration, age_restriction, ticket_open_date, ticket_provider, booking_url, notice_text, is_banner, has_timetable, locked_fields, is_hidden, hidden_at, hidden_reason",
      { count: "exact" },
    )
    .order(sortBy, { ascending: sortDir });

  // 숨김 필터: hidden=true 면 숨긴 것만, 아니면 숨김 제외(is_hidden null 도 노출)
  if (hiddenOnly) {
    eventsQuery = eventsQuery.eq("is_hidden", true);
  } else {
    eventsQuery = eventsQuery.or("is_hidden.is.null,is_hidden.eq.false");
  }

  if (search) eventsQuery = eventsQuery.ilike("title", `%${search}%`);
  if (status && VALID_STATUSES.includes(status)) {
    eventsQuery = eventsQuery.eq("status", status);
  } else if (!includeEnded) {
    // 명시적 status 필터가 없으면 끝난 공연은 숨긴다(데이터는 그대로 보존).
    eventsQuery = eventsQuery.neq("status", "ended");
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

  if (body.title.trim().length < 2 || body.title.trim().length > 300) {
    return NextResponse.json(
      {
        error: "validation_failed",
        details: ["제목은 2~300자 이내여야 합니다."],
      },
      { status: 422 },
    );
  }

  if (URL_RE.test(body.title)) {
    return NextResponse.json(
      {
        error: "validation_failed",
        details: ["제목에 URL을 포함할 수 없습니다."],
      },
      { status: 422 },
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
    body.title.trim(),
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

  // 연결도 트랜잭션 RPC 로 — 부분 실패 시 소실 방지.
  await supabase.rpc("replace_event_links", {
    p_event_id: newEventId,
    p_artist_ids: artistIds,
    p_venue_ids: venueIds,
  });

  await Promise.all(artistIds.map(recomputeUpcomingCount));

  return NextResponse.json({ ok: true });
}
