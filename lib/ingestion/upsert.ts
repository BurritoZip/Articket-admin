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
  "booking_url",
  "status",
  "genre",
] as const;

/** 기존 행 조회 컬럼 — TRACKED_FIELDS 비교에 필요한 값 전부 포함해야 한다 */
const EXISTING_COLS =
  "id, title, artist_id, poster_url, start_date, end_date, ticket_open_date, ticket_provider, booking_url, status, genre, source_urls, raw_payload";

export async function upsertEvent(
  event: NormalizedEvent,
  jobId: string,
  opts?: {
    /**
     * 분류를 아직 못 한 상태(Gemini 429 등)로 들어온 신규 이벤트를 숨긴 채로 저장한다.
     * 앱은 is_hidden=false 만 보므로 쓰레기가 안 뜨고, 상한 해제 후 재분류(reclassifyHeldEvents)가
     * keep 이면 노출, drop 이면 삭제한다. 기존 행 UPDATE 에는 영향 없다(이미 판정된 행).
     */
    holdForClassification?: boolean;
  },
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
    // 컬럼명이 실제 스키마와 달랐고(message/context → error_message/raw_payload, event_id 없음)
    // insert 실패를 .then(noop, noop) 으로 삼켜서 **검증 실패 로그가 전부 유실**되고 있었다.
    // 이제 실패하면 최소한 콘솔에 남긴다.
    const { error: logError } = await db.from("ingestion_errors").insert({
      job_id: jobId,
      source_name: event.sourceName,
      source_url: event.sourceUrls[0] ?? null,
      step: "validate",
      error_type: "validation",
      error_message: errors,
      raw_payload: { title: event.title, dedupKey: event.dedupKey },
    });
    if (logError)
      console.warn(
        `[upsertEvent] ingestion_errors 기록 실패: ${logError.message}`,
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
    .select(EXISTING_COLS)
    .eq("dedup_key", event.dedupKey)
    .maybeSingle();

  // dedup_key 미매칭 시 normalized_title + start_date 로 이중 확인 (수동 등록 이벤트 중복 방지)
  //
  // 여기서 .maybeSingle() 을 쓰면 안 된다: (normalized_title, start_date) 는 UNIQUE 가 아니라
  // 2건 이상 매칭되면 error 를 내고 data 가 null 이 된다. error 를 구조분해하지 않아 그 실패가
  // 조용히 삼켜졌고, "기존 행 없음"으로 falling through 해서 **중복 행을 새로 만들었다**
  // (그래서 중복이 3건·4건으로 증식). limit(1) 로 바꿔 다건 매칭도 정상 경로로 처리한다.
  if (!existing && event.normalizedTitle && event.startDate) {
    const { data: byTitleRows } = await db
      .from("events")
      .select(EXISTING_COLS)
      .eq("normalized_title", event.normalizedTitle)
      .eq("start_date", event.startDate)
      .order("created_at", { ascending: true })
      .limit(1);
    const byTitle = byTitleRows?.[0];
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
        booking_url: event.ticketUrl,
        dedup_key: event.dedupKey,
        source_urls: event.sourceUrls,
        source_name: event.sourceName,
        crawled_at: new Date().toISOString(),
        updated_by_crawler: true,
        raw_payload: { description: event.description },
        has_timetable: false,
        is_banner: false,
        // 분류 미완(429) 신규 이벤트는 숨긴 채 저장 → 재분류가 판정할 때까지 앱에 안 뜬다
        ...(opts?.holdForClassification
          ? {
              is_hidden: true,
              hidden_at: new Date().toISOString(),
              hidden_reason: "pending_classification",
            }
          : {}),
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
    booking_url: event.ticketUrl,
    status: event.status,
    genre: event.genre,
  };

  // description 은 raw_payload 에만 들어가는데 UPDATE 경로에 없어서, 최초 수집 때 비어 있던
  // 이벤트는 이후 크롤에서 영구히 못 채웠다. 기존 값이 없을 때만 채운다(fill-only).
  const exPayload = (ex.raw_payload as Record<string, unknown> | null) ?? null;
  if (event.description && !exPayload?.description) {
    patch.raw_payload = {
      ...(exPayload ?? {}),
      description: event.description,
    };
  }

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
    // Never overwrite a sweeper-managed status with a scraper value
    if (field === "status" && oldVal === "ended") continue;
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
