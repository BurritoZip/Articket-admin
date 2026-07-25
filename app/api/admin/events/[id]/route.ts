import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { normalizeTitle, normalizeVenueName } from "@/lib/ingestion/normalize";
import { generateDedupKey } from "@/lib/ingestion/dedup";
import { URL_RE } from "@/lib/data-quality/patterns";
import { emptyToNull } from "@/lib/ingestion/schemas";
import { recomputeUpcomingCount } from "@/lib/db/recompute-upcoming";
import type { EventRow } from "@/types/event";

// 편집 폼이 만질 수 있는 이벤트 컬럼(화이트리스트). normalized_title·dedup_key·locked_fields·
// artist_id·venue_id 는 라우트가 파생/관리하므로 폼에서 받지 않는다.
const EVENT_EDITABLE = [
  "title",
  "poster_url",
  "start_date",
  "end_date",
  "ticket_open_date",
  "ticket_close_date",
  "ticket_provider",
  "booking_url",
  "status",
  "genre",
  "duration",
  "age_restriction",
  "notice_text",
  "is_banner",
] as const;

// 운영자가 수정하면 잠그는 필드 — 다음 크롤 upsert 가 덮지 못하게. status 는 pin(sweeper 되돌림 방지).
const LOCKABLE = [
  "title",
  "poster_url",
  "start_date",
  "end_date",
  "ticket_open_date",
  "ticket_provider",
  "booking_url",
  "genre",
  "status",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Partial<EventRow> & {
    artist_ids?: string[];
    venue_ids?: string[];
    unlock_status?: boolean;
  };

  const supabaseSR = createServiceRoleClient();

  // status pin 해제 — locked_fields 에서 'status' 제거 → sweeper 가 다시 관리.
  if (body.unlock_status) {
    const { data: cur } = await supabaseSR
      .from("events")
      .select("locked_fields")
      .eq("id", params.id)
      .single();
    const nf = (
      (cur as { locked_fields: string[] | null } | null)?.locked_fields ?? []
    ).filter((f) => f !== "status");
    await supabaseSR
      .from("events")
      .update({ locked_fields: nf })
      .eq("id", params.id);
    return NextResponse.json({ ok: true, unlocked: true });
  }

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

  const { artist_ids, venue_ids } = body;

  // 화이트리스트: 편집 가능한 컬럼만, 빈 문자열은 null 로 좌표. 폼이 실어보내는
  // normalized_title·dedup_key·has_timetable 등 내부 컬럼 통째 왕복을 차단한다.
  const payload: Record<string, unknown> = {};
  for (const key of EVENT_EDITABLE) {
    if (key in body)
      payload[key] = emptyToNull((body as Record<string, unknown>)[key]);
  }
  if (typeof payload.title === "string") payload.title = payload.title.trim();

  const editedLockable = LOCKABLE.filter((f) => f in payload);

  // If artist_ids provided, set artist_id to first
  if (artist_ids && artist_ids.length > 0) {
    payload.artist_id = artist_ids[0];
  }
  // If venue_ids provided, set venue_id to first
  if (venue_ids && venue_ids.length > 0) {
    payload.venue_id = venue_ids[0];
  }

  const supabase = supabaseSR;

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
    const resolvedTitle =
      (payload.title as string | undefined) ?? cur?.title ?? "";
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

  // 아티스트/공연장 연결을 트랜잭션 RPC 로 교체 — 중간 실패 시 연결 소실 방지.
  if (artist_ids !== undefined || venue_ids !== undefined) {
    const { error: linkErr } = await supabase.rpc("replace_event_links", {
      p_event_id: params.id,
      p_artist_ids: artist_ids ?? null,
      p_venue_ids: venue_ids ?? null,
    });
    if (linkErr) {
      return NextResponse.json(
        { error: "links_failed", detail: linkErr.message },
        { status: 400 },
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
