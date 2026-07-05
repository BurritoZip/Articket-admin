/**
 * Yanolja 티켓 스크래퍼 — 콘서트 전용 페이지
 * 목록: https://nol.yanolja.com/ticket/genre/concert  (콘서트만)
 * 상세: https://nol.yanolja.com/ticket/places/{placeId}/products/{productId}  (full URL)
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

const SOURCE_NAME = "yanolja";
// 콘서트 전용 페이지 (뮤지컬/전시/클래식 섞이는 entertainment 페이지 사용 안 함)
const LIST_URL = "https://nol.yanolja.com/ticket/genre/concert";
const NOL_BASE = "https://nol.yanolja.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface RawItem {
  title: string;
  detailUrl: string; // full URL with /products/{id}
  imageUrl: string | null;
}

function parseYanoljaDate(raw: string): {
  start: string | null;
  end: string | null;
} {
  if (!raw) return { start: null, end: null };
  const century = 2000;

  // 4자리 연도 범위: "2026.10.02 ~ 2026.10.03"
  const full4 = raw.match(
    /(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s*[~–]\s*(?:(\d{4})[.\-])?(\d{1,2})[.\-](\d{1,2})/,
  );
  if (full4) {
    const [, sy, sm, sd, ey, em, ed] = full4;
    return {
      start: `${sy}-${sm.padStart(2, "0")}-${sd.padStart(2, "0")}`,
      end: `${ey ?? sy}-${em.padStart(2, "0")}-${ed.padStart(2, "0")}`,
    };
  }
  // 4자리 단일: "2026.10.02"
  const single4 = raw.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (single4) {
    const iso = `${single4[1]}-${single4[2].padStart(2, "0")}-${single4[3].padStart(2, "0")}`;
    return { start: iso, end: iso };
  }
  // 2자리 연도 범위: "26.10.02 ~ 26.10.03" (aria-label 포맷)
  const full2 = raw.match(
    /(\d{2})[.\-](\d{2})[.\-](\d{2})\s*[~–]\s*(?:(\d{2})[.\-])?(\d{2})[.\-](\d{2})/,
  );
  if (full2) {
    const [, sy, sm, sd, ey, em, ed] = full2;
    return {
      start: `${century + parseInt(sy)}-${sm}-${sd}`,
      end: `${century + parseInt(ey ?? sy)}-${em}-${ed}`,
    };
  }
  // 2자리 단일: "26.10.02"
  const single2 = raw.match(/(\d{2})[.\-](\d{2})[.\-](\d{2})/);
  if (single2) {
    const iso = `${century + parseInt(single2[1])}-${single2[2]}-${single2[3]}`;
    return { start: iso, end: iso };
  }
  return { start: null, end: null };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: NOL_BASE + "/",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Yanolja HTTP ${res.status} — ${url}`);
  return res.text();
}

interface RawItemFull extends RawItem {
  startDate: string | null;
  endDate: string | null;
  venueName: string | null;
}

function parseListHtml(html: string): RawItemFull[] {
  const items: RawItemFull[] = [];
  const seenUrls = new Set<string>();
  const $ = cheerio.load(html);

  // aria-label 형식: "제목, 공연장명, 공연 기간: 26.10.02 ~ 26.10.02"
  $("a[href*='/ticket/places/'][aria-label]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    const ariaLabel = $el.attr("aria-label") ?? "";
    if (!href.includes("/products/")) return;

    const detailUrl = href.startsWith("http") ? href : `${NOL_BASE}${href}`;
    if (seenUrls.has(detailUrl)) return;
    seenUrls.add(detailUrl);

    // aria-label 파싱: "제목, 장소명, 공연 기간: YY.MM.DD ~ YY.MM.DD"
    const parts = ariaLabel.split(",").map((p) => p.trim());
    const title = parts[0] ?? "";
    if (title.length < 2) return;

    let venueName: string | null = null;
    let startDate: string | null = null;
    let endDate: string | null = null;

    for (const part of parts.slice(1)) {
      if (/기간/.test(part)) {
        // "공연 기간: 26.10.02 ~ 26.10.02"
        const dateStr = part.replace(/공연\s*기간\s*:?\s*/i, "").trim();
        const { start, end } = parseYanoljaDate(dateStr);
        startDate = start;
        endDate = end;
      } else if (!venueName && part.length >= 2 && !/기간|^\d/.test(part)) {
        venueName = part;
      }
    }

    const img = $el.find("img").first();
    const imgSrc = img.attr("src") ?? img.attr("data-src") ?? "";
    const imageUrl = imgSrc
      ? imgSrc.startsWith("//")
        ? `https:${imgSrc}`
        : imgSrc
      : null;

    items.push({ title, detailUrl, imageUrl, startDate, endDate, venueName });
  });

  return items;
}

export async function runYanoljaScraper(
  jobId: string,
  opts: { maxItems?: number; dryRun?: boolean } = {},
): Promise<IngestionPipelineResult> {
  const { maxItems = 150, dryRun = false } = opts;
  const start = Date.now();
  const stats = {
    pagesCrawled: 0,
    eventsFound: 0,
    eventsUpserted: 0,
    eventsSkipped: 0,
    errorCount: 0,
  };
  const errors: IngestionPipelineResult["errors"] = [];

  let allItems: RawItemFull[] = [];
  try {
    const html = await fetchHtml(LIST_URL);
    stats.pagesCrawled++;
    allItems = parseListHtml(html);
  } catch (e) {
    await logCrawlError(jobId, SOURCE_NAME, LIST_URL, e);
    stats.errorCount++;
    errors.push({ url: LIST_URL, step: "crawl", message: String(e) });
    return {
      jobId,
      sourceName: SOURCE_NAME,
      ...stats,
      durationMs: Date.now() - start,
      errors,
    };
  }

  stats.eventsFound = allItems.length;

  // Gemini 분류 — 콘서트/음악 페스티벌이 아닌 것 제외
  const verdicts = await classifyTitlesKeep(allItems.map((i) => i.title));
  const keepItems = allItems.filter((_, i) => verdicts[i] === "keep");
  stats.eventsSkipped += allItems.length - keepItems.length;

  for (const item of keepItems.slice(0, maxItems)) {
    // 날짜 없는 항목 스킵 (aria-label에 날짜 없는 경우 start_date NOT NULL 위반)
    if (!item.startDate) {
      stats.eventsSkipped++;
      continue;
    }

    // 상세 페이지 CSR — 목록 aria-label에서 이미 모든 정보 추출됨
    const rawInput = {
      sourceUrl: item.detailUrl,
      sourceName: SOURCE_NAME,
      title: item.title,
      posterUrl: item.imageUrl,
      venueName: item.venueName,
      venueAddress: null,
      startDate: item.startDate,
      endDate: item.endDate,
      ticketProvider: "yanolja",
      ticketUrl: item.detailUrl,
      artists: [],
      artistProfiles: [],
      genre: "콘서트",
      description: null,
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
        sourceUrl: item.detailUrl,
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
        await logParseError(jobId, SOURCE_NAME, item.detailUrl, e);
      else await logUpsertError(jobId, SOURCE_NAME, e);
      stats.errorCount++;
      errors.push({
        url: item.detailUrl,
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
