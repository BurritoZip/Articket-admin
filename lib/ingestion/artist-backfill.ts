import { logIngestionError } from "@/lib/crawler/error-logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  linkEventArtists,
  matchOrCreateArtist,
  matchOrCreateArtists,
} from "./artist-matcher";

type EventRow = {
  id: string;
  title: string;
  artist_id: string | null;
};

type RawPayloadRow = {
  event_id: string | null;
  source_name: string;
  source_url: string;
  parsed_json: Record<string, unknown> | null;
};

type ArtistRow = {
  id: string;
  name: string;
  avatar_url: string | null;
  occupation: string | null;
  birth_date: string | null;
  birth_place: string | null;
  related: string | null;
};

export type ArtistBackfillIssueReason =
  | "missing_raw_payload"
  | "missing_artist_candidates"
  | "artist_create_failed";

export interface ArtistBackfillIssue {
  eventId: string;
  eventTitle: string;
  reason: ArtistBackfillIssueReason;
  artistCandidates: string[];
}

export interface ArtistBackfillResult {
  scannedCount: number;
  linkedCount: number;
  createdOrMatchedArtistCount: number;
  catalogCreatedOrMatchedCount: number;
  enrichmentQueuedCount: number;
  unresolvedCount: number;
  dryRun: boolean;
  issues: ArtistBackfillIssue[];
}

function getArtistCandidates(parsed: Record<string, unknown> | null): string[] {
  const raw = parsed?.artists;
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function getMissingArtistFields(artist: ArtistRow): string[] {
  return [
    ["avatar_url", artist.avatar_url],
    ["occupation", artist.occupation],
    ["birth_date", artist.birth_date],
    ["birth_place", artist.birth_place],
    ["related", artist.related],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key as string);
}

async function recomputeUpcomingCount(artistId: string) {
  const db = createServiceRoleClient();
  const { count } = await db
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("artist_id", artistId)
    .not("status", "in", "(ended,cancelled)");

  await db
    .from("artists")
    .update({ upcoming_event_count: count ?? 0 })
    .eq("id", artistId);
}

async function queueArtistEnrichment(artistId: string): Promise<boolean> {
  const db = createServiceRoleClient();
  const { data: artistData, error } = await db
    .from("artists")
    .select("id, name, avatar_url, occupation, birth_date, birth_place, related")
    .eq("id", artistId)
    .single();

  if (error || !artistData) return false;

  const artist = artistData as ArtistRow;
  const missingFields = getMissingArtistFields(artist);
  if (missingFields.length === 0) return false;

  const { data: existing } = await db
    .from("ai_processing_queue")
    .select("id")
    .eq("entity_type", "artist")
    .eq("entity_id", artistId)
    .eq("task_type", "clean_data")
    .in("status", ["pending", "processing"])
    .limit(1)
    .maybeSingle();

  if (existing) return false;

  const { error: insertError } = await db.from("ai_processing_queue").insert({
    task_type: "clean_data",
    status: "pending",
    priority: 4,
    entity_type: "artist",
    entity_id: artistId,
    payload: {
      target: "artist_profile_enrichment",
      artistId,
      artistName: artist.name,
      missingFields,
    },
  });

  return !insertError;
}

export async function runArtistBackfill(params?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<ArtistBackfillResult> {
  const db = createServiceRoleClient();
  const limit = Math.min(Math.max(params?.limit ?? 100, 1), 500);
  const dryRun = params?.dryRun ?? false;

  const { data: eventsData, error: eventsError } = await db
    .from("events")
    .select("id, title, artist_id")
    .is("artist_id", null)
    .order("start_date", { ascending: false })
    .limit(limit);

  if (eventsError) {
    throw new Error(`Artist backfill event lookup failed: ${eventsError.message}`);
  }

  const events = (eventsData ?? []) as EventRow[];
  if (events.length === 0) {
    const catalogCreatedOrMatchedCount = await backfillArtistCatalogFromPayloads(
      limit,
      dryRun,
    );
    return {
      scannedCount: 0,
      linkedCount: 0,
      createdOrMatchedArtistCount: 0,
      catalogCreatedOrMatchedCount,
      enrichmentQueuedCount: 0,
      unresolvedCount: 0,
      dryRun,
      issues: [],
    };
  }

  const eventIds = events.map((event) => event.id);
  const { data: payloadsData } = await db
    .from("raw_event_payloads")
    .select("event_id, source_name, source_url, parsed_json")
    .in("event_id", eventIds)
    .order("crawled_at", { ascending: false });

  const payloadsByEvent = new Map<string, RawPayloadRow>();
  for (const payload of (payloadsData ?? []) as RawPayloadRow[]) {
    if (payload.event_id && !payloadsByEvent.has(payload.event_id)) {
      payloadsByEvent.set(payload.event_id, payload);
    }
  }

  let linkedCount = 0;
  let createdOrMatchedArtistCount = 0;
  let catalogCreatedOrMatchedCount = 0;
  let enrichmentQueuedCount = 0;
  const linkedArtistIds = new Set<string>();
  const issues: ArtistBackfillIssue[] = [];

  for (const event of events) {
    const payload = payloadsByEvent.get(event.id);
    if (!payload) {
      issues.push({
        eventId: event.id,
        eventTitle: event.title,
        reason: "missing_raw_payload",
        artistCandidates: [],
      });
      continue;
    }

    const artistCandidates = getArtistCandidates(payload.parsed_json);
    if (!dryRun && artistCandidates.length > 0) {
      const matched = await matchOrCreateArtists(artistCandidates);
      catalogCreatedOrMatchedCount += matched.filter((item) => item.id).length;
      await linkEventArtists(event.id, matched, payload.source_name);
    } else if (dryRun) {
      catalogCreatedOrMatchedCount += artistCandidates.length;
    }
    const artistName = artistCandidates[0];
    if (!artistName) {
      issues.push({
        eventId: event.id,
        eventTitle: event.title,
        reason: "missing_artist_candidates",
        artistCandidates,
      });
      continue;
    }

    const artistId = dryRun ? "dry-run" : await matchOrCreateArtist(artistName);
    if (!artistId) {
      issues.push({
        eventId: event.id,
        eventTitle: event.title,
        reason: "artist_create_failed",
        artistCandidates,
      });
      continue;
    }

    createdOrMatchedArtistCount++;

    if (!dryRun) {
      const { error: updateError } = await db
        .from("events")
        .update({ artist_id: artistId })
        .eq("id", event.id);

      if (updateError) {
        issues.push({
          eventId: event.id,
          eventTitle: event.title,
          reason: "artist_create_failed",
          artistCandidates,
        });
        continue;
      }

      linkedArtistIds.add(artistId);
      if (await queueArtistEnrichment(artistId)) enrichmentQueuedCount++;
    }

    linkedCount++;
  }

  if (!dryRun) {
    await Promise.all(Array.from(linkedArtistIds).map(recomputeUpcomingCount));
    await Promise.all(
      issues.map((issue) =>
        logIngestionError({
          sourceName: "artist-backfill",
          sourceUrl: null,
          step: "match",
          error: new Error(
            issue.reason === "missing_raw_payload"
              ? `원본 payload가 없어 아티스트를 확인할 수 없습니다: ${issue.eventTitle}`
              : `아티스트 연결을 완료하지 못했습니다: ${issue.eventTitle}`,
          ),
          rawPayload: issue as unknown as Record<string, unknown>,
        }),
      ),
    );
  }

  return {
    scannedCount: events.length,
    linkedCount,
    createdOrMatchedArtistCount,
    catalogCreatedOrMatchedCount,
    enrichmentQueuedCount,
    unresolvedCount: issues.length,
    dryRun,
    issues: issues.slice(0, 50),
  };
}

async function backfillArtistCatalogFromPayloads(
  limit: number,
  dryRun: boolean,
): Promise<number> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("raw_event_payloads")
    .select("parsed_json")
    .not("parsed_json", "is", null)
    .order("crawled_at", { ascending: false })
    .limit(limit);

  const names = Array.from(
    new Set(
      ((data ?? []) as Array<{ parsed_json: Record<string, unknown> | null }>)
        .flatMap((row) => getArtistCandidates(row.parsed_json))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  );

  if (dryRun) return names.length;
  const matched = await matchOrCreateArtists(names);
  return matched.filter((item) => item.id).length;
}
