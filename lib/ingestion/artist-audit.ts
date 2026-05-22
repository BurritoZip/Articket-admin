import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logIngestionError } from "@/lib/crawler/error-logger";

export interface ArtistAuditIssue {
  eventId: string;
  eventTitle: string;
  sourceName: string;
  sourceUrl: string;
  reason: "missing_artist_candidates" | "missing_artist_link";
  artistCandidates: string[];
}

export interface ArtistAuditReport {
  checkedCount: number;
  missingCount: number;
  issues: ArtistAuditIssue[];
}

type RawPayloadRow = {
  id: string;
  source_name: string;
  source_url: string;
  parsed_json: Record<string, unknown> | null;
  event_id: string | null;
};

type EventRow = {
  id: string;
  title: string;
  artist_id: string | null;
};

function getArtistCandidates(parsed: Record<string, unknown> | null): string[] {
  const raw = parsed?.artists;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function auditCrawlerJobArtists(
  jobId: string,
): Promise<ArtistAuditReport> {
  const db = createServiceRoleClient();
  const { data: payloads, error } = await db
    .from("raw_event_payloads")
    .select("id, source_name, source_url, parsed_json, event_id")
    .eq("job_id", jobId)
    .eq("processed", true)
    .not("event_id", "is", null);

  if (error) {
    throw new Error(`Artist audit failed: ${error.message}`);
  }

  const rows = (payloads ?? []) as RawPayloadRow[];
  const eventIds = Array.from(
    new Set(rows.map((row) => row.event_id).filter(Boolean) as string[]),
  );

  if (eventIds.length === 0) {
    return { checkedCount: 0, missingCount: 0, issues: [] };
  }

  const { data: events, error: eventsError } = await db
    .from("events")
    .select("id, title, artist_id")
    .in("id", eventIds);

  if (eventsError) {
    throw new Error(`Artist audit event lookup failed: ${eventsError.message}`);
  }

  const eventMap = new Map(
    ((events ?? []) as EventRow[]).map((event) => [event.id, event]),
  );
  const reportedEventIds = new Set<string>();
  const issues = rows.flatMap((row): ArtistAuditIssue[] => {
    if (!row.event_id) return [];
    if (reportedEventIds.has(row.event_id)) return [];
    const event = eventMap.get(row.event_id);
    if (!event) return [];

    const artistCandidates = getArtistCandidates(row.parsed_json);
    if (event.artist_id) return [];
    reportedEventIds.add(event.id);

    return [
      {
        eventId: event.id,
        eventTitle: event.title,
        sourceName: row.source_name,
        sourceUrl: row.source_url,
        reason:
          artistCandidates.length === 0
            ? "missing_artist_candidates"
            : "missing_artist_link",
        artistCandidates,
      },
    ];
  });

  await Promise.all(
    issues.map((issue) =>
      logIngestionError({
        jobId,
        sourceName: issue.sourceName,
        sourceUrl: issue.sourceUrl,
        step: "match",
        error:
          issue.reason === "missing_artist_candidates"
            ? new Error(
                `아티스트 후보를 추출하지 못했습니다: ${issue.eventTitle}`,
              )
            : new Error(
                `아티스트 연결에 실패했습니다: ${issue.artistCandidates.join(", ")}`,
              ),
        rawPayload: {
          eventId: issue.eventId,
          eventTitle: issue.eventTitle,
          artistCandidates: issue.artistCandidates,
          reason: issue.reason,
        },
      }),
    ),
  );

  return {
    checkedCount: eventIds.length,
    missingCount: issues.length,
    issues,
  };
}
