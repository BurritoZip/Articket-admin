/**
 * Melon Ticket 스크래퍼 — JSON API
 * API: https://ticket.melon.com/performance/ajax/prodList.json
 * 장르: GENRE_CON_ALL (콘서트 전체)
 */
import { normalizeEvent } from "@/lib/ingestion/normalize";
import { upsertEvent } from "@/lib/ingestion/upsert";
import { saveRawPayload, markRawPayloadProcessed } from "@/lib/crawler/job-manager";
import { logCrawlError, logParseError, logUpsertError } from "@/lib/crawler/error-logger";
import { RawScrapedEventSchema } from "@/types/ingestion";
import type { IngestionPipelineResult } from "@/types/ingestion";

const SOURCE_NAME = "melon";
const LIST_URL = "https://ticket.melon.com/performance/ajax/prodList.json";
const DETAIL_BASE = "https://ticket.melon.com/performance/index.htm?prodId=";
const CDN_BASE = "https://cdnticket.melon.co.kr";
const PAGE_SIZE = 24;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface MelonProduct {
  prodId: string;
  prodNm: string;
  placeName?: string;
  periodInfo?: string;
  posterImg?: string;
  genreNm?: string;
}

interface MelonApiResponse {
  prodList?: MelonProduct[];
  totalCnt?: number;
}

function parseMelonDate(raw: string | undefined): {
  start: string | null;
  end: string | null;
} {
  if (!raw) return { start: null, end: null };
  const y = new Date().getFullYear();

  // "2026.07.04 ~ 2026.07.05"
  const full = raw.match(
    /(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s*[~–]\s*(?:(\d{4})[.\-])?(\d{1,2})[.\-](\d{1,2})/,
  );
  if (full) {
    const [, sy, sm, sd, ey, em, ed] = full;
    return {
      start: `${sy}-${sm.padStart(2, "0")}-${sd.padStart(2, "0")}`,
      end: `${ey ?? sy}-${em.padStart(2, "0")}-${ed.padStart(2, "0")}`,
    };
  }
  // "2026.07.04"
  const single = raw.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (single) {
    const iso = `${single[1]}-${single[2].padStart(2, "0")}-${single[3].padStart(2, "0")}`;
    return { start: iso, end: iso };
  }
  // "07.04 ~ 07.05"
  const short = raw.match(/(\d{1,2})[.\-](\d{1,2})\s*[~–]\s*(\d{1,2})[.\-](\d{1,2})/);
  if (short) {
    return {
      start: `${y}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`,
      end: `${y}-${short[3].padStart(2, "0")}-${short[4].padStart(2, "0")}`,
    };
  }
  return { start: null, end: null };
}

async function fetchPage(page: number): Promise<MelonApiResponse> {
  const params = new URLSearchParams({
    perfGenreCode: "GENRE_CON_ALL",
    sortOrder: "2",
    pageIndex: String(page),
    pageSize: String(PAGE_SIZE),
  });
  const res = await fetch(`${LIST_URL}?${params}`, {
    headers: { "User-Agent": UA, Referer: "https://ticket.melon.com/" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Melon HTTP ${res.status}`);
  return res.json() as Promise<MelonApiResponse>;
}

export async function runMelonScraper(
  jobId: string,
  opts: { maxItems?: number; dryRun?: boolean } = {},
): Promise<IngestionPipelineResult> {
  const { maxItems = 200, dryRun = false } = opts;
  const start = Date.now();
  const stats = {
    pagesCrawled: 0,
    eventsFound: 0,
    eventsUpserted: 0,
    eventsSkipped: 0,
    errorCount: 0,
  };
  const errors: IngestionPipelineResult["errors"] = [];
  const allItems: MelonProduct[] = [];

  let page = 1;
  while (allItems.length < maxItems) {
    try {
      const data = await fetchPage(page);
      stats.pagesCrawled++;
      const items = data.prodList ?? [];
      if (!items.length) break;
      allItems.push(...items);
      const total = data.totalCnt ?? 0;
      if (allItems.length >= total || items.length < PAGE_SIZE) break;
      page++;
      if (page > 20) break;
    } catch (e) {
      await logCrawlError(jobId, SOURCE_NAME, LIST_URL, e);
      stats.errorCount++;
      errors.push({ url: LIST_URL, step: "crawl", message: String(e) });
      break;
    }
  }

  stats.eventsFound = allItems.length;

  for (const item of allItems.slice(0, maxItems)) {
    const { start: startDate, end: endDate } = parseMelonDate(item.periodInfo);
    const posterUrl = item.posterImg
      ? item.posterImg.startsWith("http")
        ? item.posterImg
        : `${CDN_BASE}${item.posterImg}`
      : null;
    const sourceUrl = `${DETAIL_BASE}${item.prodId}`;

    const rawInput = {
      sourceUrl,
      sourceName: SOURCE_NAME,
      title: item.prodNm,
      posterUrl,
      venueName: item.placeName ?? null,
      venueAddress: null,
      startDate,
      endDate,
      ticketProvider: "melon",
      ticketUrl: sourceUrl,
      artists: [],
      artistProfiles: [],
      genre: "콘서트",
      status: "upcoming" as const,
      rawHtml: null,
    };

    let rawPayloadId: string | null = null;
    try {
      const parsed = RawScrapedEventSchema.safeParse(rawInput);
      if (!parsed.success) throw new Error(`Validation: ${parsed.error.message}`);
      if (dryRun) {
        stats.eventsSkipped++;
        continue;
      }

      rawPayloadId = await saveRawPayload({
        jobId,
        sourceName: SOURCE_NAME,
        sourceUrl,
        rawHtml: null,
        parsedJson: rawInput as Record<string, unknown>,
      });
      const normalized = normalizeEvent(parsed.data);
      const result = await upsertEvent(normalized, jobId);
      if (rawPayloadId && result.eventId) await markRawPayloadProcessed(rawPayloadId, result.eventId);
      result.action === "skipped" ? stats.eventsSkipped++ : stats.eventsUpserted++;
    } catch (e) {
      if (!rawPayloadId) await logParseError(jobId, SOURCE_NAME, sourceUrl, e);
      else await logUpsertError(jobId, SOURCE_NAME, e);
      stats.errorCount++;
      errors.push({ url: sourceUrl, step: rawPayloadId ? "upsert" : "parse", message: String(e) });
    }
  }

  return {
    jobId,
    sourceName: SOURCE_NAME,
    ...stats,
    durationMs: Date.now() - start,
    errors,
  };
}
