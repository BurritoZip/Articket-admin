import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { matchOrCreateArtist } from "./artist-matcher";
import type { ArtistProfileInput } from "./artist-matcher";

const STAGEPICK_API = "https://api.stagepick.co.kr/v1/artists";
const STAGEPICK_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://www.stagepick.co.kr/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

interface StagepickArtistItem {
  id?: string | number;
  name?: string;
  image_url?: string | null;
  agency?: string | null;
}

interface StagepickArtistsResponse {
  upcoming?: StagepickArtistItem[];
  popular?: StagepickArtistItem[];
}

export interface AutoImportResult {
  ok: boolean;
  inserted: number;
  artists: string[];
  days: number;
  reason?: string;
  detail?: string;
}

function extractPerfId(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  const match = sourceUrl.match(/\/performances\/detail\/(\d+)/);
  return match?.[1] ?? null;
}

function buildDateRange(
  startDate: string | null,
  endDate: string | null,
): string[] {
  if (!startDate) return [];
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;
  if (isNaN(start.getTime())) return [];
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && dates.length < 14) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

async function fetchStagepickArtists(
  perfId: string,
): Promise<StagepickArtistItem[]> {
  try {
    const res = await fetch(`${STAGEPICK_API}?performance_id=${perfId}`, {
      headers: STAGEPICK_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as StagepickArtistsResponse;
    const all = [...(data.upcoming ?? []), ...(data.popular ?? [])];
    const seen = new Set<string>();
    return all.filter((a) => {
      if (!a.name?.trim()) return false;
      const key = a.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [];
  }
}

export async function autoImportTimetableForEvent(
  eventId: string,
  replaceExisting = false,
  manualSourceUrl?: string,
): Promise<AutoImportResult> {
  const db = createServiceRoleClient();

  // 1. Fetch event metadata
  const { data: event } = await db
    .from("events")
    .select("id, title, start_date, end_date, genre")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) {
    console.warn(`[TimetableAuto] event_not_found: ${eventId}`);
    return {
      ok: false,
      inserted: 0,
      artists: [],
      days: 0,
      reason: "event_not_found",
    };
  }

  const ev = event as {
    id: string;
    title: string;
    start_date: string | null;
    end_date: string | null;
    genre: string | null;
  };

  // 2. Fetch raw payload for source_url + parsed artists
  const { data: payload } = await db
    .from("raw_event_payloads")
    .select("source_url, parsed_json")
    .eq("event_id", eventId)
    .order("crawled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const rawPayload = payload as {
    source_url?: string | null;
    parsed_json?: Record<string, unknown> | null;
  } | null;

  // 3. Try StagePick API (manual URL takes priority over raw payload)
  let apiArtists: StagepickArtistItem[] = [];
  const effectiveSourceUrl =
    manualSourceUrl?.trim() || rawPayload?.source_url || null;
  const perfId = extractPerfId(effectiveSourceUrl);
  if (perfId) {
    apiArtists = await fetchStagepickArtists(perfId);
  }

  // 4. Fallback: parsed_json.artists / artistProfiles
  let artistNames: string[] = apiArtists.map((a) => a.name!.trim());
  if (artistNames.length === 0 && rawPayload?.parsed_json) {
    const parsed = rawPayload.parsed_json;
    const fallback = (parsed.artists ?? parsed.artistProfiles) as unknown;
    if (Array.isArray(fallback)) {
      artistNames = (fallback as Array<string | { name?: string }>)
        .map((a) => (typeof a === "string" ? a : (a.name ?? "")))
        .filter(Boolean)
        .map((n) => n.trim());
    }
  }

  if (artistNames.length === 0) {
    const reason =
      !rawPayload && !manualSourceUrl
        ? "no_raw_payload"
        : !perfId
          ? "no_stagepick_id"
          : "no_artists_found";
    console.warn(
      `[TimetableAuto] ${reason}: event="${ev.title}" (${eventId}) sourceUrl=${effectiveSourceUrl ?? "none"}`,
    );
    return { ok: false, inserted: 0, artists: [], days: 0, reason };
  }

  // 5. Compute date/day distribution
  const dates = buildDateRange(ev.start_date, ev.end_date);
  const dayCount = Math.max(1, dates.length);

  // 6. Replace existing if requested
  if (replaceExisting) {
    await db.from("timetable_performances").delete().eq("event_id", eventId);
  }

  // 7. Insert timetable_performances
  const inserted: string[] = [];

  for (let i = 0; i < artistNames.length; i++) {
    const name = artistNames[i];
    const apiArtist = apiArtists[i];

    const profile: ArtistProfileInput | undefined = apiArtist?.image_url
      ? {
          name,
          avatarUrl: apiArtist.image_url,
          metadata: apiArtist.agency ? { agency: apiArtist.agency } : {},
        }
      : undefined;

    const artistId = await matchOrCreateArtist(name, profile);

    // Distribute across days round-robin
    const dayIndex = dayCount > 1 ? i % dayCount : 0;
    const dayNumber = dayIndex + 1;
    const dateString = dates[dayIndex] ?? "";

    const { error } = await db.from("timetable_performances").insert({
      event_id: eventId,
      artist_id: artistId,
      artist_name: name,
      day_number: dayNumber,
      date_string: dateString,
      start_time: "",
      end_time: "",
      stage_name: "",
      genre: ev.genre ?? "",
    });

    if (!error) inserted.push(name);
  }

  // 8. Mark event as having timetable
  if (inserted.length > 0) {
    await db.from("events").update({ has_timetable: true }).eq("id", eventId);
  }

  return {
    ok: true,
    inserted: inserted.length,
    artists: inserted,
    days: dayCount,
  };
}
