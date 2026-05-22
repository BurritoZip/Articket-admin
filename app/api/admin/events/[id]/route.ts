import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { normalizeTitle, normalizeVenueName } from "@/lib/ingestion/normalize";
import { generateDedupKey } from "@/lib/ingestion/dedup";
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

  const body = (await request.json()) as Partial<EventRow>;

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

  const payload: Partial<EventRow> = { ...body };
  if (typeof payload.title === "string") payload.title = payload.title.trim();

  const supabase = createServiceRoleClient();

  // Recompute normalized_title and dedup_key when relevant fields change
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

  const affectsCount = "artist_id" in payload || "status" in payload;
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

  if (affectsCount) {
    const newArtistId =
      (payload.artist_id as string | null | undefined) ?? oldArtistId;
    const artistsToUpdate = new Set<string>(
      [oldArtistId, newArtistId].filter(Boolean) as string[],
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

  const { data: existing } = await supabase
    .from("events")
    .select("artist_id")
    .eq("id", params.id)
    .single();
  const artistId =
    (existing as { artist_id: string | null } | null)?.artist_id ?? null;

  const { error } = await supabase.from("events").delete().eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: "delete_failed", detail: error.message },
      { status: 400 },
    );
  }

  if (artistId) {
    await recomputeUpcomingCount(artistId);
  }

  return NextResponse.json({ ok: true });
}
