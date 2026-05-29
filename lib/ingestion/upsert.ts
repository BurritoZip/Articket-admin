import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  linkEventArtists,
  linkEventVenues,
  matchOrCreateArtists,
  matchOrCreateVenue,
} from "./artist-matcher";
import { validateEvent } from "./schemas";
import type { NormalizedEvent, UpsertResult } from "@/types/ingestion";

const TRACKED_FIELDS = [
  "title",
  "poster_url",
  "start_date",
  "end_date",
  "ticket_open_date",
  "ticket_provider",
  "status",
  "genre",
] as const;

export async function upsertEvent(
  event: NormalizedEvent,
  jobId: string,
): Promise<UpsertResult> {
  const db = createServiceRoleClient();

  // ── 입력 유효성 검증 ──────────────────────────────────────────────
  const validation = validateEvent({
    title: event.title,
    start_date: event.startDate,
    end_date: event.endDate,
    status: event.status,
    dedup_key: event.dedupKey,
    source_name: event.sourceName,
  });

  if (!validation.ok) {
    const errors = validation.errors.join("; ");
    console.warn(
      `[upsertEvent] 유효성 검증 실패 ("${event.title}"): ${errors}`,
    );
    await db
      .from("ingestion_errors")
      .insert({
        source_name: event.sourceName,
        event_id: null,
        step: "validate",
        message: errors,
        context: { title: event.title, dedupKey: event.dedupKey },
      })
      .then(
        () => null,
        () => null,
      );
    return { action: "skipped", eventId: "", changes: [] };
  }

  const matchedArtists = await matchOrCreateArtists(
    event.artists,
    event.artistProfiles,
  );
  const artistId = matchedArtists[0]?.id ?? null;
  const venueId = await matchOrCreateVenue(event.venueName, event.venueAddress);

  // 기존 이벤트 조회 (dedup_key 기반)
  let { data: existing } = await db
    .from("events")
    .select(
      "id, title, artist_id, poster_url, start_date, end_date, ticket_open_date, ticket_provider, status, genre, source_urls",
    )
    .eq("dedup_key", event.dedupKey)
    .maybeSingle();

  // dedup_key 미매칭 시 normalized_title + start_date 로 이중 확인 (수동 등록 이벤트 중복 방지)
  if (!existing && event.normalizedTitle && event.startDate) {
    const { data: byTitle } = await db
      .from("events")
      .select(
        "id, title, artist_id, poster_url, start_date, end_date, ticket_open_date, ticket_provider, status, genre, source_urls",
      )
      .eq("normalized_title", event.normalizedTitle)
      .eq("start_date", event.startDate)
      .maybeSingle();
    if (byTitle) {
      existing = byTitle;
      // dedup_key 동기화
      await db
        .from("events")
        .update({ dedup_key: event.dedupKey })
        .eq("id", (byTitle as { id: string }).id);
    }
  }

  if (!existing) {
    // INSERT
    const { data: inserted, error } = await db
      .from("events")
      .insert({
        title: event.title,
        normalized_title: event.normalizedTitle,
        artist_id: artistId,
        venue_id: venueId,
        poster_url: event.posterUrl,
        start_date: event.startDate,
        end_date: event.endDate,
        status: event.status,
        genre: event.genre,
        ticket_open_date: event.ticketOpenDate,
        ticket_provider: event.ticketProvider,
        dedup_key: event.dedupKey,
        source_urls: event.sourceUrls,
        source_name: event.sourceName,
        crawled_at: new Date().toISOString(),
        updated_by_crawler: true,
        raw_payload: { description: event.description },
        has_timetable: false,
        is_banner: false,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Upsert insert failed: ${error.message}`);
    const insertedId = (inserted as { id: string }).id;
    await Promise.all([
      linkEventArtists(insertedId, matchedArtists, event.sourceName),
      linkEventVenues(insertedId, venueId ? [venueId] : []),
    ]);
    return {
      action: "inserted",
      eventId: insertedId,
      changes: [],
    };
  }

  // UPDATE — detect changes
  const ex = existing as Record<string, unknown>;
  const changes: UpsertResult["changes"] = [];
  const patch: Record<string, unknown> = {};

  const fieldMap: Record<string, unknown> = {
    title: event.title,
    poster_url: event.posterUrl,
    start_date: event.startDate,
    end_date: event.endDate,
    ticket_open_date: event.ticketOpenDate,
    ticket_provider: event.ticketProvider,
    status: event.status,
    genre: event.genre,
  };

  if (!ex.artist_id && artistId) {
    patch.artist_id = artistId;
    changes.push({
      field: "artist_id",
      oldValue: null,
      newValue: artistId,
    });
  }

  for (const field of TRACKED_FIELDS) {
    const newVal = fieldMap[field];
    const oldVal = ex[field];
    if (
      newVal !== undefined &&
      newVal !== null &&
      String(newVal) !== String(oldVal ?? "")
    ) {
      patch[field] = newVal;
      changes.push({
        field,
        oldValue: oldVal as string | null,
        newValue: newVal as string,
      });
    }
  }

  // source_urls 병합
  const existingUrls = (ex.source_urls as string[] | null) ?? [];
  const mergedUrls = Array.from(
    new Set([...existingUrls, ...event.sourceUrls]),
  );
  if (mergedUrls.length !== existingUrls.length) patch.source_urls = mergedUrls;

  if (Object.keys(patch).length > 0) {
    patch.crawled_at = new Date().toISOString();
    patch.updated_by_crawler = true;

    const { error: updateError } = await db
      .from("events")
      .update(patch)
      .eq("id", ex.id as string);
    if (updateError)
      throw new Error(`Upsert update failed: ${updateError.message}`);

    // 변경 이력 저장
    if (changes.length > 0) {
      await db.from("event_change_logs").insert(
        changes.map((c) => ({
          event_id: ex.id as string,
          job_id: jobId,
          field_name: c.field,
          old_value: c.oldValue,
          new_value: c.newValue,
        })),
      );
    }

    await Promise.all([
      linkEventArtists(ex.id as string, matchedArtists, event.sourceName),
      linkEventVenues(ex.id as string, venueId ? [venueId] : []),
    ]);
    return { action: "updated", eventId: ex.id as string, changes };
  }

  await Promise.all([
    linkEventArtists(ex.id as string, matchedArtists, event.sourceName),
    linkEventVenues(ex.id as string, venueId ? [venueId] : []),
  ]);
  return { action: "skipped", eventId: ex.id as string, changes: [] };
}
