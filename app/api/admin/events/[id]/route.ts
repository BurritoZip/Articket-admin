import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { normalizeTitle, normalizeVenueName } from "@/lib/ingestion/normalize";
import { generateDedupKey } from "@/lib/ingestion/dedup";
import { URL_RE } from "@/lib/data-quality/patterns";
import type { EventRow } from "@/types/event";

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

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Partial<EventRow> & {
    artist_ids?: string[];
    venue_ids?: string[];
  };

  if (body.title !== undefined) {
    const t = body.title?.trim() ?? "";
    if (t.length < 2 || t.length > 300 || URL_RE.test(t)) {
      return NextResponse.json(
        {
          error: "validation_failed",
          details: ["제목은 2~300자, URL 포함 불가"],
        },
        { status: 422 },
      );
    }
  }

  if (body.end_date && !isNaN(Date.parse(body.end_date)) === false) {
    return NextResponse.json(
      { error: "validation_failed", details: ["end_date 날짜 형식 오류"] },
      { status: 422 },
    );
  }

  if (
    body.start_date &&
    body.end_date &&
    new Date(body.end_date) < new Date(body.start_date)
  ) {
    return NextResponse.json(
      {
        error: "invalid_date_range",
        detail: "종료일은 시작일보다 빠를 수 없습니다.",
      },
      { status: 400 },
    );
  }

  const { artist_ids, venue_ids, ...eventFields } = body;
  const payload: Partial<EventRow> = { ...eventFields };
  if (typeof payload.title === "string") payload.title = payload.title.trim();

  // 운영자가 수정한 크롤 관리 필드는 잠근다 → 다음 크롤 upsert 가 덮어쓰지 못한다.
  // (status 는 sweeper 가 관리하므로 잠금 대상에서 제외)
  const LOCKABLE = [
    "title",
    "poster_url",
    "start_date",
    "end_date",
    "ticket_open_date",
    "ticket_provider",
    "booking_url",
    "genre",
  ] as const;
  const editedLockable = LOCKABLE.filter((f) => f in eventFields);

  // If artist_ids provided, set artist_id to first
  if (artist_ids && artist_ids.length > 0) {
    payload.artist_id = artist_ids[0];
  }
  // If venue_ids provided, set venue_id to first
  if (venue_ids && venue_ids.length > 0) {
    payload.venue_id = venue_ids[0];
  }

  const supabase = createServiceRoleClient();

  // Recompute dedup fields if relevant columns changed
  const needsDedup = payload.title || payload.venue_id || payload.start_date;
  if (needsDedup) {
    const { data: current } = await supabase
      .from("events")
      .select("title, venue_id, start_date")
      .eq("id", params.id)
      .single();
    const cur = current as {
      title: string;
      venue_id: string | null;
      start_date: string;
    } | null;
    const resolvedTitle = payload.title ?? cur?.title ?? "";
    const resolvedVenueId =
      (payload.venue_id as string | undefined) ?? cur?.venue_id ?? null;
    const resolvedStart = (
      (payload.start_date as string | undefined) ??
      cur?.start_date ??
      ""
    ).slice(0, 10);

    let venueName: string | null = null;
    if (resolvedVenueId) {
      const { data: v } = await supabase
        .from("venues")
        .select("name")
        .eq("id", resolvedVenueId)
        .maybeSingle();
      venueName = (v as { name?: string } | null)?.name ?? null;
    }

    const normTitle = normalizeTitle(resolvedTitle);
    payload.normalized_title = normTitle;
    payload.dedup_key = generateDedupKey(
      normTitle,
      normalizeVenueName(venueName),
      resolvedStart,
    );
  }

  const affectsCount =
    "artist_id" in payload ||
    "status" in payload ||
    (artist_ids !== undefined && artist_ids.length > 0);

  let oldArtistId: string | null = null;
  if (affectsCount) {
    const { data: current } = await supabase
      .from("events")
      .select("artist_id")
      .eq("id", params.id)
      .single();
    oldArtistId =
      (current as { artist_id: string | null } | null)?.artist_id ?? null;
  }

  // 수정된 잠금 대상 필드를 기존 locked_fields 와 합집합
  if (editedLockable.length > 0) {
    const { data: cur } = await supabase
      .from("events")
      .select("locked_fields")
      .eq("id", params.id)
      .single();
    const existing =
      (cur as { locked_fields: string[] | null } | null)?.locked_fields ?? [];
    payload.locked_fields = Array.from(
      new Set([...existing, ...editedLockable]),
    );
  }

  const { error } = await supabase
    .from("events")
    .update(payload)
    .eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: "update_failed", detail: error.message },
      { status: 400 },
    );
  }

  // Update event_artists if artist_ids provided
  if (artist_ids !== undefined) {
    await supabase.from("event_artists").delete().eq("event_id", params.id);
    if (artist_ids.length > 0) {
      const { data: artistRows } = await supabase
        .from("artists")
        .select("id, name")
        .in("id", artist_ids);
      const artistNameMap = new Map(
        ((artistRows as { id: string; name: string }[] | null) ?? []).map(
          (a) => [a.id, a.name],
        ),
      );
      await supabase.from("event_artists").insert(
        artist_ids.map((aid, i) => ({
          event_id: params.id,
          artist_id: aid,
          artist_name: artistNameMap.get(aid) ?? "",
          role: "lineup",
          display_order: i,
        })),
      );
    }
  }

  // Update event_venues if venue_ids provided
  if (venue_ids !== undefined) {
    await supabase.from("event_venues").delete().eq("event_id", params.id);
    if (venue_ids.length > 0) {
      await supabase.from("event_venues").insert(
        venue_ids.map((vid, i) => ({
          event_id: params.id,
          venue_id: vid,
          display_order: i,
        })),
      );
    }
  }

  if (affectsCount) {
    const newArtistId =
      (payload.artist_id as string | null | undefined) ?? oldArtistId;
    const artistsToUpdate = new Set<string>(
      [...(artist_ids ?? []), oldArtistId, newArtistId].filter(
        Boolean,
      ) as string[],
    );
    await Promise.all(Array.from(artistsToUpdate).map(recomputeUpcomingCount));
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createServiceRoleClient();

  // Fetch all artists for this event before deletion
  const { data: eventArtists } = await supabase
    .from("event_artists")
    .select("artist_id")
    .eq("event_id", params.id);
  const artistIds = (
    (eventArtists as { artist_id: string }[] | null) ?? []
  ).map((a) => a.artist_id);

  // Fallback to events.artist_id if event_artists is empty
  if (artistIds.length === 0) {
    const { data: existing } = await supabase
      .from("events")
      .select("artist_id")
      .eq("id", params.id)
      .single();
    const artistId =
      (existing as { artist_id: string | null } | null)?.artist_id ?? null;
    if (artistId) artistIds.push(artistId);
  }

  const { error } = await supabase.from("events").delete().eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: "delete_failed", detail: error.message },
      { status: 400 },
    );
  }

  await Promise.all(artistIds.map(recomputeUpcomingCount));

  return NextResponse.json({ ok: true });
}
