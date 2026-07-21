/**
 * Interpark 티켓 스크래퍼 — __NEXT_DATA__ 파싱
 * GET https://tickets.interpark.com/contents/genre/concert
 * 실제 공연 날짜는 banner.bigBanner / miniBanner / hotItem 에 있음 (playStartDate/playEndDate).
 * ticketOpen 은 예매오픈 안내라서 날짜가 없으므로 배너 목록을 우선 사용하고,
 * ticketOpen 아이템은 goodsCode 로 배너와 cross-ref 해서 날짜 보완.
 */
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

const SOURCE_NAME = "interpark";
const LIST_URL = "https://tickets.interpark.com/contents/genre/concert";
const GOODS_BASE = "https://tickets.interpark.com/goods/";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// 비콘서트 subGroupCode/genreStr 필터
const NON_CONCERT_SUB = new Set([
  "Musi",
  "Play",
  "Exhi",
  "Clas",
  "Oper",
  "Danc",
  "Ball",
  "Trad",
]);
const NON_CONCERT_GENRE_STR = new Set([
  "뮤지컬",
  "연극",
  "전시",
  "클래식",
  "오페라",
  "무용",
  "발레",
  "국악",
  "MUSICAL",
  "PLAY",
  "EXHIBITION",
  "CLASSIC",
  "OPERA",
  "DANCE",
  "BALLET",
]);

interface BannerItem {
  goodsCode?: string;
  title?: string;
  goodsName?: string;
  placeName?: string;
  posterImageUrl?: string;
  imageUrl?: string;
  playStartDate?: string; // "YYYYMMDD"
  playEndDate?: string; // "YYYYMMDD"
  subGroupCode?: string;
  genreCode?: string;
  genreName?: string;
}

function parseBannerDate(raw: string | undefined): string | null {
  if (!raw || raw.length < 8) return null;
  // "20260726" → "2026-07-26"
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function isConcert(item: BannerItem): boolean {
  if (item.subGroupCode && NON_CONCERT_SUB.has(item.subGroupCode)) return false;
  if (item.genreName && NON_CONCERT_GENRE_STR.has(item.genreName)) return false;
  return true;
}

async function fetchListData(): Promise<BannerItem[]> {
  const res = await fetch(LIST_URL, {
    headers: { "User-Agent": UA, Referer: "https://tickets.interpark.com/" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Interpark HTTP ${res.status}`);
  const html = await res.text();

  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("Interpark: __NEXT_DATA__ 없음");

  const json = JSON.parse(match[1]);
  const props = json?.props?.pageProps ?? {};
  const banner = props.banner ?? {};

  // bigBanner, miniBanner, hotItem — 모두 실제 공연날짜(playStartDate) 있음
  const bannerItems: BannerItem[] = [
    ...(Array.isArray(banner.bigBanner) ? banner.bigBanner : []),
    ...(Array.isArray(banner.miniBanner) ? banner.miniBanner : []),
    ...(Array.isArray(banner.hotItem) ? banner.hotItem : []),
  ];

  // interparkPlay.goodsInfo 도 포함
  const plays: BannerItem[] = (
    Array.isArray(props.interparkPlay) ? props.interparkPlay : []
  ).map((p: { goodsInfo?: BannerItem; title?: string; imageUrl?: string }) => ({
    ...(p.goodsInfo ?? {}),
    title: p.goodsInfo?.goodsName ?? p.title,
    imageUrl: p.imageUrl,
  }));

  // ticketOpen 중 위 배너에 없는 것은 날짜가 없어서 제외
  // (배너 항목만으로도 충분히 데이터 확보 가능)
  return [...bannerItems, ...plays];
}

export async function runInterparkScraper(
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

  let items: BannerItem[] = [];
  try {
    items = await fetchListData();
    stats.pagesCrawled = 1;
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

  // 콘서트만, 날짜 없는 것 제외, 이미 종료된 것 제외, 중복 goodsCode 제거
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // "YYYYMMDD"
  const seen = new Set<string>();
  const filtered = items.filter((it) => {
    if (!it.goodsCode || !(it.title ?? it.goodsName)) return false;
    if (!it.playStartDate) return false;
    // 종료일 기준: playEndDate 또는 playStartDate 가 오늘보다 과거면 스킵
    const endDate = it.playEndDate ?? it.playStartDate;
    if (endDate < todayStr) return false;
    if (!isConcert(it)) return false;
    if (seen.has(it.goodsCode)) return false;
    seen.add(it.goodsCode);
    return true;
  });

  stats.eventsFound = filtered.length;

  // Gemini 분류 — 콘서트/음악 페스티벌이 아닌 것 제외
  const verdicts = await classifyTitlesKeep(
    filtered.map((i) => (i.title ?? i.goodsName)!),
  );
  // drop 만 제외. unknown(분류 실패)은 숨긴 채 저장하고 재분류가 판정한다.
  const kept = filtered
    .map((it, i) => ({ it, held: verdicts[i] === "unknown" }))
    .filter((_, i) => verdicts[i] !== "drop");
  stats.eventsSkipped += filtered.length - kept.length;

  for (const { it: item, held } of kept.slice(0, maxItems)) {
    const sourceUrl = `${GOODS_BASE}${item.goodsCode}`;
    const startDate = parseBannerDate(item.playStartDate);
    const endDate = parseBannerDate(item.playEndDate);
    const title = (item.title ?? item.goodsName)!;
    const posterUrl = item.posterImageUrl ?? item.imageUrl ?? null;

    const rawInput = {
      sourceUrl,
      sourceName: SOURCE_NAME,
      title,
      posterUrl: posterUrl
        ? posterUrl.startsWith("//")
          ? `https:${posterUrl}`
          : posterUrl
        : null,
      venueName: item.placeName ?? null,
      venueAddress: null,
      startDate,
      endDate,
      ticketProvider: "interpark",
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
      const result = await upsertEvent(normalized, jobId, {
        holdForClassification: held,
      });
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
