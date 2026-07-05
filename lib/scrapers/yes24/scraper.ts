/**
 * Yes24 티켓 스크래퍼 — AJAX HTML 파싱
 * 목록 API: https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx
 * 장르코드: 15456=콘서트전체, 15464=페스티벌
 */
import * as cheerio from "cheerio";
import { normalizeEvent } from "@/lib/ingestion/normalize";
import { upsertEvent } from "@/lib/ingestion/upsert";
import {
  saveRawPayload,
  markRawPayloadProcessed,
} from "@/lib/crawler/job-manager";
import {
  logCrawlError,
  logParseError,
  logUpsertError,
} from "@/lib/crawler/error-logger";
import { RawScrapedEventSchema } from "@/types/ingestion";
import type { IngestionPipelineResult } from "@/types/ingestion";
import { classifyTitlesKeep } from "@/lib/data-quality/classify-keep";

const SOURCE_NAME = "yes24";
const AJAX_URL = "https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx";
const DETAIL_BASE = "https://ticket.yes24.com/Perf/";
const GENRE_CODES = ["15456", "15464"]; // 콘서트전체, 페스티벌
const PAGE_SIZE = 20;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseYes24Date(raw: string): {
  start: string | null;
  end: string | null;
} {
  if (!raw) return { start: null, end: null };
  const y = new Date().getFullYear();

  // "2026.07.04 ~ 2026.07.05" or "2026.07.04 ~ 07.05"
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
  const short = raw.match(
    /(\d{1,2})[.\-](\d{1,2})\s*[~–]\s*(\d{1,2})[.\-](\d{1,2})/,
  );
  if (short) {
    return {
      start: `${y}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`,
      end: `${y}-${short[3].padStart(2, "0")}-${short[4].padStart(2, "0")}`,
    };
  }
  return { start: null, end: null };
}

async function fetchPage(genreCode: string, page: number): Promise<string> {
  const params = new URLSearchParams({
    genre: genreCode,
    sort: "3",
    area: "",
    genretype: "1",
    pCurPage: String(page),
    pPageSize: String(PAGE_SIZE),
  });
  const res = await fetch(`${AJAX_URL}?${params}`, {
    headers: { "User-Agent": UA, Referer: "https://ticket.yes24.com/" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Yes24 HTTP ${res.status}`);
  return res.text();
}

interface RawItem {
  title: string;
  venueName: string;
  startDate: string | null;
  endDate: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  genre: string;
}

function parseListHtml(html: string, genreCode: string): RawItem[] {
  const $ = cheerio.load(html);
  const items: RawItem[] = [];

  $("a[onclick*='GoToPerfDetail']").each((_, el) => {
    const $el = $(el);
    const title = $el.attr("title") || $el.find("p.list-b-tit1").text().trim();
    if (!title) return;

    let venueName = "";
    let dateRaw = "";
    $el.find("p.list-b-tit2").each((_, p) => {
      const txt = $(p).text().trim();
      if (/\d{4}[.\-]|\d{4}년/.test(txt)) dateRaw = txt;
      else venueName = txt;
    });

    const { start, end } = parseYes24Date(dateRaw);

    let imageUrl: string | null = null;
    const img = $el.find("img[data-src]").first() || $el.find("img").first();
    const src = img.attr("data-src") || img.attr("src") || "";
    if (src) imageUrl = src.startsWith("//") ? `https:${src}` : src;

    const onclick = $el.attr("onclick") || "";
    const idMatch = onclick.match(/GoToPerfDetail\((\d+)\)/);
    const sourceUrl = idMatch ? `${DETAIL_BASE}${idMatch[1]}` : null;

    items.push({
      title,
      venueName,
      startDate: start,
      endDate: end,
      imageUrl,
      sourceUrl,
      genre: genreCode === "15464" ? "축제" : "콘서트",
    });
  });

  return items;
}

export async function runYes24Scraper(
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
  const allItems: RawItem[] = [];

  for (const code of GENRE_CODES) {
    let page = 1;
    while (allItems.length < maxItems) {
      try {
        const html = await fetchPage(code, page);
        stats.pagesCrawled++;
        const items = parseListHtml(html, code);
        if (!items.length) break;
        allItems.push(...items);
        if (items.length < PAGE_SIZE) break;
        page++;
        if (page > 20) break;
      } catch (e) {
        await logCrawlError(
          jobId,
          SOURCE_NAME,
          `${AJAX_URL}?genre=${code}&page=${page}`,
          e,
        );
        stats.errorCount++;
        errors.push({ url: AJAX_URL, step: "crawl", message: String(e) });
        break;
      }
    }
  }

  stats.eventsFound = allItems.length;

  // Gemini 분류 — 콘서트/음악 페스티벌이 아닌 것 제외
  const verdicts = await classifyTitlesKeep(allItems.map((i) => i.title));
  const keepItems = allItems.filter((_, i) => verdicts[i] === "keep");
  stats.eventsSkipped += allItems.length - keepItems.length;

  for (const item of keepItems.slice(0, maxItems)) {
    const rawInput = {
      sourceUrl:
        item.sourceUrl ?? `${AJAX_URL}?title=${encodeURIComponent(item.title)}`,
      sourceName: SOURCE_NAME,
      title: item.title,
      posterUrl: item.imageUrl ?? null,
      venueName: item.venueName || null,
      venueAddress: null,
      startDate: item.startDate,
      endDate: item.endDate,
      ticketProvider: "yes24",
      ticketUrl: item.sourceUrl ?? null,
      artists: [],
      artistProfiles: [],
      genre: item.genre,
      status: "upcoming" as const,
      rawHtml: null,
    };

    let rawPayloadId: string | null = null;
    try {
      const parsed = RawScrapedEventSchema.safeParse(rawInput);
      if (!parsed.success)
        throw new Error(`Validation: ${parsed.error.message}`);
      if (dryRun) {
        stats.eventsSkipped++;
        continue;
      }

      rawPayloadId = await saveRawPayload({
        jobId,
        sourceName: SOURCE_NAME,
        sourceUrl: rawInput.sourceUrl,
        rawHtml: null,
        parsedJson: rawInput as Record<string, unknown>,
      });
      const normalized = normalizeEvent(parsed.data);
      const result = await upsertEvent(normalized, jobId);
      if (rawPayloadId && result.eventId)
        await markRawPayloadProcessed(rawPayloadId, result.eventId);
      result.action === "skipped"
        ? stats.eventsSkipped++
        : stats.eventsUpserted++;
    } catch (e) {
      if (!rawPayloadId)
        await logParseError(jobId, SOURCE_NAME, rawInput.sourceUrl, e);
      else await logUpsertError(jobId, SOURCE_NAME, e);
      stats.errorCount++;
      errors.push({
        url: rawInput.sourceUrl,
        step: rawPayloadId ? "upsert" : "parse",
        message: String(e),
      });
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
