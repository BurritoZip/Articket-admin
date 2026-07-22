/**
 * Melon Ticket 스크래퍼 — JSON API
 *
 * API: https://ticket.melon.com/performance/ajax/prodList.json
 * 2026-07 사이트 개편으로 파라미터가 바뀌어 옛 스크래퍼(perfGenreCode=GENRE_CON_ALL + sortOrder +
 * pageIndex/pageSize)가 HTTP 500 으로 죽어 소스가 비활성됐었다. 리버스로 확인한 새 계약:
 *   - 세션 쿠키(JSESSIONID) 필요 — concert 목록 페이지 1회 방문으로 획득
 *   - 파라미터: commCode='' & sortType=HIT & perfGenreCode=GENRE_CON_ALL &
 *     perfThemeCode='' & filterCode=FILTER_ALL & v=1  (sortOrder→sortType, filterCode 추가)
 *   - 응답: { result: 0, data: [ {prodId,title,placeName,periodInfo,posterImg,saleTypeJson,...} ] }
 *     (옛 prodList → data, prodNm → title). 페이지네이션 없이 전량 반환.
 * 예매 오픈/마감일은 saleTypeJson(web POC 일반예매 ST0001)에서 직접 파싱해 그라운딩 호출을 아낀다.
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

const SOURCE_NAME = "melon";
const CONCERT_PAGE =
  "https://ticket.melon.com/concert/index.htm?genreType=GENRE_CON";
const LIST_URL = "https://ticket.melon.com/performance/ajax/prodList.json";
const DETAIL_BASE = "https://ticket.melon.com/performance/index.htm?prodId=";
const CDN_BASE = "https://cdnticket.melon.co.kr";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface MelonProduct {
  prodId: number;
  title?: string;
  placeName?: string;
  periodInfo?: string;
  posterImg?: string;
  coverImg?: string;
  saleTypeJson?: string;
}

/** "2026.08.22 - 2026.08.23" / "2026.08.22" → {start, end} (ISO date) */
function parseMelonDate(raw: string | undefined): {
  start: string | null;
  end: string | null;
} {
  if (!raw) return { start: null, end: null };
  const y = new Date().getFullYear();

  // 범위: "2026.08.22 - 2026.08.23" (구분자는 공백으로 둘러싼 -~– 만, 날짜 내부 . 과 구분)
  const full = raw.match(
    /(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s+[-~–]\s+(?:(\d{4})[.\-])?(\d{1,2})[.\-](\d{1,2})/,
  );
  if (full) {
    const [, sy, sm, sd, ey, em, ed] = full;
    return {
      start: `${sy}-${sm.padStart(2, "0")}-${sd.padStart(2, "0")}`,
      end: `${ey ?? sy}-${em.padStart(2, "0")}-${ed.padStart(2, "0")}`,
    };
  }
  // 단일: "2026.08.22"
  const single = raw.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (single) {
    const iso = `${single[1]}-${single[2].padStart(2, "0")}-${single[3].padStart(2, "0")}`;
    return { start: iso, end: iso };
  }
  // "08.22 - 08.23" (연도 없음)
  const short = raw.match(/(\d{1,2})[.\-](\d{1,2})\s+[-~–]\s+(\d{1,2})[.\-](\d{1,2})/);
  if (short) {
    return {
      start: `${y}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`,
      end: `${y}-${short[3].padStart(2, "0")}-${short[4].padStart(2, "0")}`,
    };
  }
  return { start: null, end: null };
}

/** "20260716200000" (KST) → "2026-07-16T20:00:00+09:00" */
function parseMelonDateTime(raw: string | null | undefined): string | null {
  if (!raw || !/^\d{14}$/.test(raw)) return null;
  const [, Y, M, D, h, m, s] =
    raw.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/) ?? [];
  if (!Y) return null;
  return `${Y}-${M}-${D}T${h}:${m}:${s}+09:00`;
}

/** saleTypeJson(web POC 일반예매 ST0001)에서 예매 오픈/마감일 추출 */
function parseTicketDates(saleTypeJson: string | undefined): {
  open: string | null;
  close: string | null;
} {
  if (!saleTypeJson) return { open: null, close: null };
  try {
    const parsed = JSON.parse(saleTypeJson) as {
      data?: {
        list?: {
          pocName?: string;
          saleTypeCodeList?: {
            saleTypeCode?: string;
            reserveStartDt?: string;
            reserveEndDt?: string;
          }[];
        }[];
      };
    };
    const web =
      parsed.data?.list?.find((p) => p.pocName === "web") ??
      parsed.data?.list?.[0];
    // 일반예매(ST0001) 우선, 없으면 첫 항목
    const sale =
      web?.saleTypeCodeList?.find((s) => s.saleTypeCode === "ST0001") ??
      web?.saleTypeCodeList?.[0];
    return {
      open: parseMelonDateTime(sale?.reserveStartDt),
      close: parseMelonDateTime(sale?.reserveEndDt),
    };
  } catch {
    return { open: null, close: null };
  }
}

/** concert 목록 페이지 1회 방문으로 세션 쿠키 획득 */
async function fetchSessionCookie(): Promise<string> {
  const res = await fetch(CONCERT_PAGE, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  return (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function fetchList(cookie: string): Promise<MelonProduct[]> {
  const params = new URLSearchParams({
    commCode: "",
    sortType: "HIT",
    perfGenreCode: "GENRE_CON_ALL",
    perfThemeCode: "",
    filterCode: "FILTER_ALL",
    v: "1",
  });
  const res = await fetch(`${LIST_URL}?${params}`, {
    headers: {
      "User-Agent": UA,
      Referer: CONCERT_PAGE,
      "X-Requested-With": "XMLHttpRequest",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Melon HTTP ${res.status}`);
  const json = (await res.json()) as { result?: number; data?: MelonProduct[] };
  return Array.isArray(json.data) ? json.data : [];
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

  let allItems: MelonProduct[] = [];
  try {
    const cookie = await fetchSessionCookie();
    allItems = await fetchList(cookie);
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

  stats.eventsFound = allItems.length;

  for (const item of allItems.slice(0, maxItems)) {
    const title = item.title?.trim();
    if (!title) {
      stats.eventsSkipped++;
      continue;
    }
    const { start: startDate, end: endDate } = parseMelonDate(item.periodInfo);
    const { open: ticketOpenDate } = parseTicketDates(item.saleTypeJson);
    const posterRaw = item.posterImg || item.coverImg || "";
    const posterUrl = posterRaw
      ? posterRaw.startsWith("http")
        ? posterRaw
        : `${CDN_BASE}${posterRaw}`
      : null;
    const sourceUrl = `${DETAIL_BASE}${item.prodId}`;

    const rawInput = {
      sourceUrl,
      sourceName: SOURCE_NAME,
      title,
      posterUrl,
      venueName: item.placeName ?? null,
      venueAddress: null,
      startDate,
      endDate,
      ticketOpenDate,
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
