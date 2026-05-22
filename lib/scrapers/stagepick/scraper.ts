import { parseArtistDetailPage, parseDetailPage } from "./parser";
import { normalizeEvent } from "@/lib/ingestion/normalize";
import { upsertEvent } from "@/lib/ingestion/upsert";
import { saveRawPayload, markRawPayloadProcessed } from "@/lib/crawler/job-manager";
import { logCrawlError, logParseError, logUpsertError } from "@/lib/crawler/error-logger";
import { RawScrapedEventSchema } from "@/types/ingestion";
import type { IngestionPipelineResult } from "@/types/ingestion";
import type { ScrapeOptions } from "@/lib/scrapers/base/adapter";

const SOURCE_NAME = "stagepick";
const API_BASE = "https://api.stagepick.co.kr/v1/performances";
const DETAIL_BASE = "https://www.stagepick.co.kr/performances/detail";
const PAGE_SIZE = 50;

interface StagepickPerformance {
  id: string;
  title: string;
  venue: string | null;
  image_url: string | null;
  formatted_date: string | null;
  ticket_open_date: string | null;
  ticket_status: string | null;
  is_ongoing?: boolean;
}

interface StagepickApiResponse {
  performances: StagepickPerformance[];
  total_count: number;
  has_next_page: boolean;
  items_per_page: number;
}

function parseStagepickDate(formatted: string | null): { start: string | null; end: string | null } {
  if (!formatted) return { start: null, end: null };

  const currentYear = new Date().getFullYear();

  // "2026. 05. 22 ~ 2026. 05. 24" or "2026. 05. 22 ~ 05. 24"
  const fullRangeMatch = formatted.match(
    /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*[~–-]\s*(?:(\d{4})\.\s*)?(\d{1,2})\.\s*(\d{1,2})/,
  );
  if (fullRangeMatch) {
    const [, sy, sm, sd, ey, em, ed] = fullRangeMatch;
    const startYear = parseInt(sy);
    const endYear = ey ? parseInt(ey) : startYear;
    return {
      start: `${startYear}-${sm.padStart(2, "0")}-${sd.padStart(2, "0")}`,
      end: `${endYear}-${em.padStart(2, "0")}-${ed.padStart(2, "0")}`,
    };
  }

  // "05. 22 ~ 05. 24" (no year)
  const shortRangeMatch = formatted.match(/(\d{1,2})\.\s*(\d{1,2})\s*[~–-]\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (shortRangeMatch) {
    const [, sm, sd, em, ed] = shortRangeMatch;
    return {
      start: `${currentYear}-${sm.padStart(2, "0")}-${sd.padStart(2, "0")}`,
      end: `${currentYear}-${em.padStart(2, "0")}-${ed.padStart(2, "0")}`,
    };
  }

  // "2026. 05. 22" (single date with year)
  const fullDateMatch = formatted.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (fullDateMatch) {
    const [, y, m, d] = fullDateMatch;
    const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return { start: iso, end: iso };
  }

  // "05. 22" (single date, no year)
  const shortDateMatch = formatted.match(/(\d{1,2})\.\s*(\d{1,2})/);
  if (shortDateMatch) {
    const [, m, d] = shortDateMatch;
    const iso = `${currentYear}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return { start: iso, end: iso };
  }

  return { start: null, end: null };
}

async function fetchPage(offset: number): Promise<StagepickApiResponse> {
  const url = `${API_BASE}?limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://www.stagepick.co.kr/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`StagePick API HTTP ${res.status}`);
  return res.json() as Promise<StagepickApiResponse>;
}

async function fetchDetailHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Referer: "https://www.stagepick.co.kr/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`StagePick detail HTTP ${res.status}`);
  return res.text();
}

async function fetchArtistProfiles(
  artistDetails: Array<{ name: string; detailUrl: string | null }>,
): Promise<
  Array<{
    name: string;
    sourceUrl?: string | null;
    avatarUrl?: string | null;
    occupation?: string | null;
    birthDate?: string | null;
    related?: string | null;
    metadata?: Record<string, unknown>;
  }>
> {
  const profiles = [];
  for (const artist of artistDetails) {
    if (!artist.detailUrl) {
      profiles.push({ name: artist.name, sourceUrl: null });
      continue;
    }
    try {
      const html = await fetchDetailHtml(artist.detailUrl);
      profiles.push(parseArtistDetailPage(html, artist.detailUrl));
    } catch {
      profiles.push({ name: artist.name, sourceUrl: artist.detailUrl });
    }
  }
  return profiles;
}

export async function runStagepickScraper(
  jobId: string,
  options: ScrapeOptions = {},
): Promise<IngestionPipelineResult> {
  const start = Date.now();
  const { maxItems = 100, dryRun = false } = options;

  const stats = {
    pagesCrawled: 0,
    eventsFound: 0,
    eventsUpserted: 0,
    eventsSkipped: 0,
    errorCount: 0,
  };
  const errors: IngestionPipelineResult["errors"] = [];

  // Fetch all performances from API with pagination
  const allPerformances: StagepickPerformance[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore && allPerformances.length < maxItems) {
    let page: StagepickApiResponse;
    try {
      page = await fetchPage(offset);
      stats.pagesCrawled++;
    } catch (e) {
      await logCrawlError(jobId, SOURCE_NAME, `${API_BASE}?offset=${offset}`, e);
      stats.errorCount++;
      errors.push({ url: API_BASE, step: "crawl", message: String(e) });
      break;
    }

    allPerformances.push(...page.performances);
    hasMore = page.has_next_page;
    offset += PAGE_SIZE;
  }

  const performances = allPerformances.slice(0, maxItems);
  stats.eventsFound = performances.length;

  for (const perf of performances) {
    const sourceUrl = `${DETAIL_BASE}/${perf.id}`;
    let detail: ReturnType<typeof parseDetailPage> | null = null;
    let rawHtml: string | null = null;

    try {
      rawHtml = await fetchDetailHtml(sourceUrl);
      detail = parseDetailPage(rawHtml, sourceUrl);
      stats.pagesCrawled++;
    } catch (e) {
      await logCrawlError(jobId, SOURCE_NAME, sourceUrl, e);
      stats.errorCount++;
      errors.push({ url: sourceUrl, step: "crawl", message: String(e) });
    }

    const dateRange = detail?.dateRange ?? perf.formatted_date;
    const { start: startDate, end: endDate } = parseStagepickDate(dateRange);

    // Parse ticket open date (ISO datetime → date string)
    let ticketOpenDate: string | null = null;
    if (perf.ticket_open_date) {
      const d = new Date(perf.ticket_open_date);
      if (!isNaN(d.getTime())) {
        ticketOpenDate = d.toISOString().slice(0, 10);
      }
    }

    const artistProfiles = detail?.artistDetails
      ? await fetchArtistProfiles(detail.artistDetails)
      : [];

    const rawInput = {
      sourceUrl,
      sourceName: SOURCE_NAME,
      title: perf.title || detail?.title || "",
      posterUrl: detail?.posterUrl ?? perf.image_url ?? null,
      venueName: detail?.venueName ?? perf.venue ?? null,
      venueAddress: detail?.venueAddress ?? null,
      startDate,
      endDate,
      ticketOpenDate: detail?.ticketOpenDate ?? ticketOpenDate,
      ticketProvider: detail?.ticketProvider ?? "스테이지픽",
      ticketUrl: detail?.ticketUrl ?? sourceUrl,
      artists: detail?.artists ?? [],
      artistProfiles,
      genre: detail?.genre ?? null,
      description: detail?.description ?? null,
      status: "upcoming" as const,
      rawHtml,
    };

    let rawPayloadId: string | null = null;

    try {
      const parsed = RawScrapedEventSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new Error(`Validation: ${parsed.error.message}`);
      }

      if (!dryRun) {
        rawPayloadId = await saveRawPayload({
          jobId,
          sourceName: SOURCE_NAME,
          sourceUrl,
          rawHtml,
          parsedJson: rawInput as Record<string, unknown>,
        });
      }

      if (dryRun) {
        stats.eventsSkipped++;
        continue;
      }

      const normalized = normalizeEvent(parsed.data);
      const result = await upsertEvent(normalized, jobId);

      if (rawPayloadId && result.eventId) {
        await markRawPayloadProcessed(rawPayloadId, result.eventId);
      }

      if (result.action === "skipped") {
        stats.eventsSkipped++;
      } else {
        stats.eventsUpserted++;
      }
    } catch (e) {
      if (rawPayloadId === null) {
        await logParseError(jobId, SOURCE_NAME, sourceUrl, e);
      } else {
        await logUpsertError(jobId, SOURCE_NAME, e);
      }
      stats.errorCount++;
      errors.push({ url: sourceUrl, step: rawPayloadId ? "upsert" : "parse", message: String(e) });
    }
  }

  return {
    jobId,
    sourceName: SOURCE_NAME,
    pagesCrawled: stats.pagesCrawled,
    eventsFound: stats.eventsFound,
    eventsUpserted: stats.eventsUpserted,
    eventsSkipped: stats.eventsSkipped,
    errorCount: stats.errorCount,
    durationMs: Date.now() - start,
    errors,
  };
}
