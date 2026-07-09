import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logIngestionError } from "@/lib/crawler/error-logger";

export interface ArtistAuditIssue {
  eventId: string;
  eventTitle: string;
  sourceName: string;
  sourceUrl: string;
  reason:
    | "missing_artist_candidates"
    | "missing_artist_link"
    | "missing_festival_timetable"
    | "timetable_artist_mismatch";
  artistCandidates: string[];
  timetableArtists?: string[];
  searchQueries?: string[];
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
  genre: string | null;
  has_timetable: boolean | null;
};

type TimetableRow = {
  event_id: string;
  artist_name: string;
};

function getArtistCandidates(parsed: Record<string, unknown> | null): string[] {
  const raw = parsed?.artists;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function isFestival(event: EventRow): boolean {
  return (
    /페스티벌|festival/i.test(event.title) ||
    /페스티벌|festival/i.test(event.genre ?? "")
  );
}

function buildSearchQueries(eventTitle: string): string[] {
  return [
    `${eventTitle} 타임테이블`,
    `${eventTitle} 출연진`,
    `${eventTitle} lineup timetable`,
  ];
}

// match_artist(event) 큐잉 중단(no-op) — 이 task_type 을 처리하는 컨슈머가 없어
// 큐에 무한 적체만 됐다. 페스티벌 라인업은 enrich 의 collectFestivalLineup(그라운딩)이,
// 개별 아티스트는 enrichEventArtists 가 직접 채운다. 미연결 신호는 ingestion_errors
// (step='match') 로 별도 기록돼 admin 에서 조회 가능하므로 큐 등록은 불필요.
// 처리기를 다시 만들면 여기서 큐잉을 복구하면 된다.
async function queueExternalArtistVerification(_params: {
  eventId: string;
  eventTitle: string;
  sourceUrl: string;
  reason: ArtistAuditIssue["reason"];
  artistCandidates: string[];
  timetableArtists?: string[];
  searchQueries: string[];
}): Promise<void> {
  void _params;
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
    .select("id, title, artist_id, genre, has_timetable")
    .in("id", eventIds);

  if (eventsError) {
    throw new Error(`Artist audit event lookup failed: ${eventsError.message}`);
  }

  const eventMap = new Map(
    ((events ?? []) as EventRow[]).map((event) => [event.id, event]),
  );
  const { data: timetableData } = await db
    .from("timetable_performances")
    .select("event_id, artist_name")
    .in("event_id", eventIds);
  const timetableByEvent = new Map<string, string[]>();
  for (const row of (timetableData ?? []) as TimetableRow[]) {
    const list = timetableByEvent.get(row.event_id) ?? [];
    if (row.artist_name?.trim()) list.push(row.artist_name.trim());
    timetableByEvent.set(row.event_id, list);
  }

  const reportedEventIds = new Set<string>();
  const issues = rows.flatMap((row): ArtistAuditIssue[] => {
    if (!row.event_id) return [];
    const event = eventMap.get(row.event_id);
    if (!event) return [];

    const artistCandidates = getArtistCandidates(row.parsed_json);
    const timetableArtists = Array.from(
      new Set(timetableByEvent.get(event.id) ?? []),
    );

    const eventIssues: ArtistAuditIssue[] = [];
    if (!event.artist_id && !reportedEventIds.has(`${event.id}:link`)) {
      reportedEventIds.add(`${event.id}:link`);
      eventIssues.push({
        eventId: event.id,
        eventTitle: event.title,
        sourceName: row.source_name,
        sourceUrl: row.source_url,
        reason:
          artistCandidates.length === 0
            ? "missing_artist_candidates"
            : "missing_artist_link",
        artistCandidates,
        timetableArtists,
        searchQueries: buildSearchQueries(event.title),
      });
    }

    if (
      isFestival(event) &&
      timetableArtists.length === 0 &&
      !reportedEventIds.has(`${event.id}:timetable`)
    ) {
      reportedEventIds.add(`${event.id}:timetable`);
      eventIssues.push({
        eventId: event.id,
        eventTitle: event.title,
        sourceName: row.source_name,
        sourceUrl: row.source_url,
        reason: "missing_festival_timetable",
        artistCandidates,
        timetableArtists,
        searchQueries: buildSearchQueries(event.title),
      });
    }

    if (
      timetableArtists.length > 0 &&
      artistCandidates.length > 0 &&
      !reportedEventIds.has(`${event.id}:mismatch`)
    ) {
      const parsedSet = new Set(artistCandidates.map(normalizeName));
      const missingFromParsed = timetableArtists.filter(
        (artist) => !parsedSet.has(normalizeName(artist)),
      );
      if (missingFromParsed.length > 0) {
        reportedEventIds.add(`${event.id}:mismatch`);
        eventIssues.push({
          eventId: event.id,
          eventTitle: event.title,
          sourceName: row.source_name,
          sourceUrl: row.source_url,
          reason: "timetable_artist_mismatch",
          artistCandidates,
          timetableArtists,
          searchQueries: buildSearchQueries(event.title),
        });
      }
    }

    if (eventIssues.length === 0) return [];
    reportedEventIds.add(event.id);
    return eventIssues;
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
            : issue.reason === "missing_festival_timetable"
              ? new Error(
                  `페스티벌 타임테이블 외부 검증이 필요합니다: ${issue.eventTitle}`,
                )
              : issue.reason === "timetable_artist_mismatch"
                ? new Error(
                    `파싱 출연진과 타임테이블 아티스트가 일치하지 않습니다: ${issue.eventTitle}`,
                  )
                : new Error(
                    `아티스트 연결에 실패했습니다: ${issue.artistCandidates.join(", ")}`,
                  ),
        rawPayload: {
          eventId: issue.eventId,
          eventTitle: issue.eventTitle,
          artistCandidates: issue.artistCandidates,
          timetableArtists: issue.timetableArtists ?? [],
          reason: issue.reason,
          searchQueries:
            issue.searchQueries ?? buildSearchQueries(issue.eventTitle),
        },
      }),
    ),
  );
  await Promise.all(
    issues.map((issue) =>
      queueExternalArtistVerification({
        eventId: issue.eventId,
        eventTitle: issue.eventTitle,
        sourceUrl: issue.sourceUrl,
        reason: issue.reason,
        artistCandidates: issue.artistCandidates,
        timetableArtists: issue.timetableArtists,
        searchQueries:
          issue.searchQueries ?? buildSearchQueries(issue.eventTitle),
      }),
    ),
  );

  return {
    checkedCount: eventIds.length,
    missingCount: issues.length,
    issues,
  };
}
