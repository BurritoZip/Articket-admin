/**
 * FestivalLife 스크래퍼
 * 목록: https://www.festivallife.kr/{cat}/?bmode=list&t=board&page=N
 * 아이템 링크 패턴: /concert/?q=...&bmode=view&idx={id}&t=board
 * 상세: 위 링크 직접 파싱
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

const SOURCE_NAME = "festivallife";
const BASE = "https://www.festivallife.kr";
const CATEGORIES: Array<{ cat: string; genre: string }> = [
  { cat: "concert", genre: "콘서트" },
  { cat: "festival", genre: "축제" },
  { cat: "concert_k", genre: "콘서트" },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface RawItem {
  title: string;
  detailUrl: string;
  genre: string;
}

interface DetailData {
  posterUrl: string | null;
  venueName: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

function parseFLDate(raw: string): {
  start: string | null;
  end: string | null;
} {
  if (!raw) return { start: null, end: null };
  const y = new Date().getFullYear();

  const full = raw.match(
    /(\d{4})[.\-년\s]+\s*(\d{1,2})[.\-월\s]+\s*(\d{1,2})[일\s]*\s*[~–]\s*(?:(\d{4})[.\-년\s]+\s*)?(\d{1,2})[.\-월\s]+\s*(\d{1,2})/,
  );
  if (full) {
    const [, sy, sm, sd, ey, em, ed] = full;
    return {
      start: `${sy}-${sm.padStart(2, "0")}-${sd.padStart(2, "0")}`,
      end: `${ey ?? sy}-${em.padStart(2, "0")}-${ed.padStart(2, "0")}`,
    };
  }
  const single = raw.match(
    /(\d{4})[.\-년\s]+\s*(\d{1,2})[.\-월\s]+\s*(\d{1,2})/,
  );
  if (single) {
    const iso = `${single[1]}-${single[2].padStart(2, "0")}-${single[3].padStart(2, "0")}`;
    return { start: iso, end: iso };
  }
  const short = raw.match(
    /(\d{1,2})[월.\-]?\s*(\d{1,2})\s*[~–]\s*(\d{1,2})[월.\-]?\s*(\d{1,2})/,
  );
  if (short) {
    return {
      start: `${y}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`,
      end: `${y}-${short[3].padStart(2, "0")}-${short[4].padStart(2, "0")}`,
    };
  }
  return { start: null, end: null };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: BASE },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`FestivalLife HTTP ${res.status} — ${url}`);
  return res.text();
}

function parseListPage(html: string, genre: string): RawItem[] {
  const $ = cheerio.load(html);
  const items: RawItem[] = [];

  // 실제 아이템 링크 = bmode=view 패턴
  $("a[href*='bmode=view']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    if (!href.includes("idx=")) return;

    const detailUrl = href.startsWith("http") ? href : `${BASE}${href}`;

    // div.title 내부 텍스트 노드만 추출 (em.notice-block 등 자식 요소 제거)
    const titleEl = $el.find("div.title, .title-block").first();
    const title = titleEl.length
      ? titleEl.clone().children().remove().end().text().trim()
      : "";
    if (!title || title.length < 2) return;

    items.push({ title, detailUrl, genre });
  });

  return items;
}

async function parseDetailPage(html: string): Promise<DetailData> {
  const $ = cheerio.load(html);

  // OG 이미지
  const posterUrl: string | null =
    $("meta[property='og:image']").attr("content") ?? null;

  // og:title에서 suffix 제거 (" : 국내공연 정보" 등)
  // (목록에서 이미 title 추출하므로 여기선 사용 안 함)

  // og:description에 날짜·장소 포함돼 있음
  // 예: "2026년 7월 10일 (금) 오후 7시 30분신도시예매하기..."
  const ogDesc =
    $("meta[property='og:description']").attr("content")?.trim() ?? "";

  // 날짜: og:description 또는 페이지 전체 텍스트에서
  const pageText = $("body").text().replace(/\s+/g, " ");
  const combinedText = ogDesc + " " + pageText;

  // 날짜 패턴: "2026년 7월 10일", "2026.07.10", "2026-07-10"
  const { start: startDate, end: endDate } = parseFLDate(combinedText);

  // 장소: og:description 또는 페이지에서
  const venueM =
    ogDesc.match(/(?:장소|venue|공연장)\s*[:：]?\s*([^\n,]+)/i) ||
    pageText.match(/(?:장소|venue|공연장)\s*[:：]?\s*([^\n,]{2,40})/i);
  const venueName = venueM?.[1]?.trim().slice(0, 100) ?? null;

  const description = ogDesc.slice(0, 500) || null;

  return { posterUrl, venueName, startDate, endDate, description };
}

export async function runFestivallifeScraper(
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
  const allItems: RawItem[] = [];
  const seenUrls = new Set<string>();

  for (const { cat, genre } of CATEGORIES) {
    let page = 1;
    while (allItems.length < maxItems) {
      const listUrl = `${BASE}/${cat}/?bmode=list&t=board&page=${page}`;
      try {
        const html = await fetchHtml(listUrl);
        stats.pagesCrawled++;
        const items = parseListPage(html, genre).filter((it) => {
          if (seenUrls.has(it.detailUrl)) return false;
          seenUrls.add(it.detailUrl);
          return true;
        });
        if (!items.length) break;
        allItems.push(...items);
        page++;
        if (page > 10) break;
      } catch (e) {
        await logCrawlError(jobId, SOURCE_NAME, listUrl, e);
        stats.errorCount++;
        errors.push({ url: listUrl, step: "crawl", message: String(e) });
        break;
      }
    }
  }

  stats.eventsFound = allItems.length;

  // Gemini 분류 — 상세 페이지 fetch 전에 미리 걸러서 불필요한 요청 줄임
  const verdicts = await classifyTitlesKeep(allItems.map((i) => i.title));
  // drop 만 제외. unknown(분류 실패)은 숨긴 채 저장하고 재분류가 판정한다.
  const kept = allItems
    .map((it, i) => ({ it, held: verdicts[i] === "unknown" }))
    .filter((_, i) => verdicts[i] !== "drop");
  stats.eventsSkipped += allItems.length - kept.length;

  for (const { it: item, held } of kept.slice(0, maxItems)) {
    let detail: DetailData = {
      posterUrl: null,
      venueName: null,
      startDate: null,
      endDate: null,
      description: null,
    };
    try {
      const detailHtml = await fetchHtml(item.detailUrl);
      detail = await parseDetailPage(detailHtml);
    } catch (e) {
      await logCrawlError(jobId, SOURCE_NAME, item.detailUrl, e);
      stats.errorCount++;
      errors.push({ url: item.detailUrl, step: "crawl", message: String(e) });
    }

    const rawInput = {
      sourceUrl: item.detailUrl,
      sourceName: SOURCE_NAME,
      title: item.title,
      posterUrl: detail.posterUrl,
      venueName: detail.venueName,
      venueAddress: null,
      startDate: detail.startDate,
      endDate: detail.endDate,
      ticketProvider: null,
      ticketUrl: null,
      artists: [],
      artistProfiles: [],
      genre: item.genre,
      description: detail.description,
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
      const result = await upsertEvent(normalized, jobId, {
        holdForClassification: held,
      });
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
