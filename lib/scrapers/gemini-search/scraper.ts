/**
 * Gemini 그라운딩 검색 스크래퍼 — 보조 데이터 수집
 * 웹 스크래핑으로 놓친 국내 콘서트/페스티벌을 Gemini Google Search 그라운딩으로 보완.
 * 결과는 RawScrapedEvent 형태로 정규화 후 upsert.
 */
import { geminiTextGrounded } from "@/lib/gemini";
import { classifyTitlesKeep } from "@/lib/data-quality/classify-keep";
import { normalizeEvent } from "@/lib/ingestion/normalize";
import { upsertEvent } from "@/lib/ingestion/upsert";
import {
  saveRawPayload,
  markRawPayloadProcessed,
} from "@/lib/crawler/job-manager";
import { logParseError, logUpsertError } from "@/lib/crawler/error-logger";
import { RawScrapedEventSchema } from "@/types/ingestion";
import type { IngestionPipelineResult } from "@/types/ingestion";

const SOURCE_NAME = "gemini-search";

interface GeminiEvent {
  title: string;
  venueName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  artists?: string[];
  genre?: string;
  ticketUrl?: string | null;
  description?: string | null;
}

interface GeminiSearchResult {
  events: GeminiEvent[];
}

const SEARCH_QUERIES = [
  "2026년 하반기 국내 콘서트 일정 서울 부산 예매",
  "2026년 국내 음악 페스티벌 야외 공연 일정",
  "2026 K-POP 콘서트 팬미팅 일정 예매",
  "2026년 하반기 대형 콘서트 홀 공연 일정",
];

async function searchConcerts(query: string): Promise<GeminiEvent[]> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `오늘은 ${today}이다.
다음 검색어로 국내 공연 정보를 찾아라: "${query}"

반드시 아래 JSON 형식만 반환. 설명 금지.
**대중음악(가수·밴드·아이돌·래퍼·싱어송라이터)의 콘서트와 "음악" 페스티벌(락페·재즈·힙합·EDM 등)만** 포함하라.
다음은 절대 포함하지 마라: 뮤지컬·연극·전시·클래식·오페라·무용·발레.
그리고 **음악이 주가 아닌 축제/행사도 절대 포함하지 마라**: 지역축제·문화제·민속/전통 행사, 종교·불교·사찰·소원성취·기원제, 먹거리·음식·맥주·커피 축제, 꽃/벚꽃 축제, 불꽃축제, 빛축제, 관광/지자체 홍보행사. (예: "경산갓바위소원성취축제", "○○문화제")
이미 지난 공연(end_date < ${today})은 제외.

{
  "events": [
    {
      "title": "공연 제목",
      "venueName": "공연장명 또는 null",
      "startDate": "YYYY-MM-DD 또는 null",
      "endDate": "YYYY-MM-DD 또는 null",
      "artists": ["아티스트1", "아티스트2"],
      "genre": "콘서트 또는 축제",
      "ticketUrl": "예매 URL 또는 null",
      "description": "간략 설명 또는 null"
    }
  ]
}

최대 10개. 확실하지 않은 정보는 null.`;

  const raw = await geminiTextGrounded(prompt);
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as GeminiSearchResult;
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

function makeSourceUrl(event: GeminiEvent): string {
  if (event.ticketUrl) return event.ticketUrl;
  // 안정적인 fallback URL — 제목 기반
  const slug = encodeURIComponent(event.title.slice(0, 60));
  return `https://gemini-search.internal/event?q=${slug}`;
}

export async function runGeminiSearchScraper(
  jobId: string,
  opts: { maxItems?: number; dryRun?: boolean } = {},
): Promise<IngestionPipelineResult> {
  const { maxItems = 80, dryRun = false } = opts;
  const start = Date.now();
  const stats = {
    pagesCrawled: 0,
    eventsFound: 0,
    eventsUpserted: 0,
    eventsSkipped: 0,
    errorCount: 0,
  };
  const errors: IngestionPipelineResult["errors"] = [];
  const allEvents: GeminiEvent[] = [];
  const seenTitles = new Set<string>();

  for (const query of SEARCH_QUERIES) {
    if (allEvents.length >= maxItems) break;
    try {
      const found = await searchConcerts(query);
      stats.pagesCrawled++;
      for (const ev of found) {
        const key = ev.title.trim().toLowerCase();
        if (!key || seenTitles.has(key)) continue;
        seenTitles.add(key);
        allEvents.push(ev);
      }
    } catch (e) {
      stats.errorCount++;
      errors.push({
        url: `gemini-search:${query}`,
        step: "crawl",
        message: String(e),
      });
    }
    // Gemini API rate limit 방지
    await new Promise((r) => setTimeout(r, 1000));
  }

  stats.eventsFound = allEvents.length;

  // 대중음악 콘서트/음악 페스티벌만 — 비음악(전시·연극·지역축제·종교행사 등) 제거
  const capped = allEvents.slice(0, maxItems);
  const verdicts = await classifyTitlesKeep(capped.map((e) => e.title));
  const keepEvents = capped.filter((_, i) => verdicts[i] === "keep");
  stats.eventsSkipped += capped.length - keepEvents.length;

  for (const ev of keepEvents) {
    const sourceUrl = makeSourceUrl(ev);
    const rawInput = {
      sourceUrl,
      sourceName: SOURCE_NAME,
      title: ev.title.trim(),
      posterUrl: null,
      venueName: ev.venueName ?? null,
      venueAddress: null,
      startDate: ev.startDate ?? null,
      endDate: ev.endDate ?? null,
      ticketProvider: null,
      ticketUrl: ev.ticketUrl ?? null,
      artists: ev.artists ?? [],
      artistProfiles: [],
      genre: ev.genre ?? "콘서트",
      description: ev.description ?? null,
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
        sourceUrl,
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
      if (!rawPayloadId) await logParseError(jobId, SOURCE_NAME, sourceUrl, e);
      else await logUpsertError(jobId, SOURCE_NAME, e);
      stats.errorCount++;
      errors.push({
        url: sourceUrl,
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
