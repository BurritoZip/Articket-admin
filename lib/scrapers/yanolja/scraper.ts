/**
 * Yanolja(NOL) 티켓 스크래퍼 — 콘서트 장르 페이지(페스티벌·내한공연 포함)
 * 목록: https://nol.yanolja.com/ticket/genre/concert
 *   - 상품 앵커의 aria-label 에서 제목·예매오픈일 추출
 * 상세: https://nol.yanolja.com/ticket/products/{productId}
 *   - Next.js RSC 스트림(self.__next_f)에 상품 JSON 임베드 → 공연날짜/공연장/주소/장르/설명/포스터 추출
 *   - 페스티벌 라인업(출연 아티스트)은 NOL 구조화 데이터에 없음(빈값) → enrich 단계(Gemini)가 보강
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
const LIST_URL = "https://nol.yanolja.com/ticket/genre/concert";
const NOL_BASE = "https://nol.yanolja.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface RawItem {
  title: string;
  detailUrl: string;
  productId: string;
  listImage: string | null;
  ticketOpenRaw: string | null; // aria-label "오픈일: MM.DD(요일) HH:MM"
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

// ── 목록 파싱 ────────────────────────────────────────────────────────

function parseListHtml(html: string): RawItem[] {
  const items: RawItem[] = [];
  const seen = new Set<string>();
  const $ = cheerio.load(html);

  $("a[href*='/ticket/'][aria-label]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    const ariaLabel = $el.attr("aria-label") ?? "";
    const idMatch = href.match(/\/products\/(\d+)/);
    if (!idMatch) return;
    const productId = idMatch[1];
    if (seen.has(productId)) return;
    seen.add(productId);

    // aria-label 첫 조각 = 제목 ("제목, HOT, 단독판매, 오픈일: ..." 또는 "제목, 공연장, 공연 기간: ...")
    const title = (ariaLabel.split(",")[0] ?? "").trim();
    if (title.length < 2) return;

    const openMatch = ariaLabel.match(/오픈일\s*:?\s*([^,]+)/);
    const ticketOpenRaw = openMatch ? openMatch[1].trim() : null;

    const img = $el.find("img").first();
    const imgSrc = img.attr("src") ?? img.attr("data-src") ?? "";
    const listImage = imgSrc
      ? imgSrc.startsWith("//")
        ? `https:${imgSrc}`
        : imgSrc
      : null;

    items.push({
      title,
      detailUrl: `${NOL_BASE}/ticket/products/${productId}`,
      productId,
      listImage,
      ticketOpenRaw,
    });
  });

  return items;
}

// ── 상세(RSC) 파싱 ───────────────────────────────────────────────────

interface DetailData {
  playStart: string | null;
  playEnd: string | null;
  venueName: string | null;
  address: string | null;
  subGenre: string | null;
  description: string | null;
  poster: string | null;
}

/** Next.js RSC 스트림 청크(self.__next_f.push([1,"..."]))를 이어붙여 원본 JSON 텍스트 복원 */
function rscBlob(html: string): string {
  const re = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g;
  let blob = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      blob += JSON.parse(m[1]) as string;
    } catch {
      /* 청크 파싱 실패 무시 */
    }
  }
  return blob;
}

function rscField(blob: string, key: string): string | null {
  const m = blob.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
}

/** noticeInfo(HTML 조각) → 평문 설명, 과도한 길이 컷 */
function cleanDescription(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, 1500) : null;
}

function parseDetail(html: string): DetailData {
  const blob = rscBlob(html);
  const iso = (v: string | null) =>
    v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  return {
    playStart: iso(rscField(blob, "playStartDate")),
    playEnd: iso(rscField(blob, "playEndDate")),
    venueName: rscField(blob, "placeName"),
    address: rscField(blob, "address"),
    subGenre: rscField(blob, "subGenreName"),
    description: cleanDescription(rscField(blob, "noticeInfo")),
    // NOL 포스터는 interpark 티켓 이미지(고화질) — 목록 썸네일보다 우선
    poster: rscField(blob, "posterImageUrl"),
  };
}

// Articket 장르 버킷: 콘서트/축제/기타. NOL subGenreName 매핑.
function mapGenre(subGenre: string | null): string {
  if (!subGenre) return "콘서트";
  if (/페스티벌|페스타|fest/i.test(subGenre)) return "축제";
  return "콘서트"; // 콘서트/내한공연 등
}

/** aria-label 오픈일("MM.DD(요일) HH:MM") → ISO KST. 연도는 공연 시작연도로 추정. */
function parseTicketOpen(
  raw: string | null,
  playStart: string | null,
): string | null {
  if (!raw) return null;
  const m = raw.match(
    /(\d{1,2})[.\-](\d{1,2})(?:\([^)]*\))?\s*(\d{1,2}:\d{2})?/,
  );
  if (!m) return null;
  const [, mm, dd, time] = m;
  const year = playStart
    ? Number(playStart.slice(0, 4))
    : new Date().getFullYear();
  const hhmm = time ?? "00:00";
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${hhmm}:00+09:00`;
}

// ── 실행 ─────────────────────────────────────────────────────────────

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

  let allItems: RawItem[] = [];
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
  // drop 만 제외. unknown(분류 실패)은 숨긴 채 저장하고 재분류가 판정한다.
  const kept = allItems
    .map((it, i) => ({ it, held: verdicts[i] === "unknown" }))
    .filter((_, i) => verdicts[i] !== "drop");
  stats.eventsSkipped += allItems.length - kept.length;

  for (const { it: item, held } of kept.slice(0, maxItems)) {
    let detail: DetailData = {
      playStart: null,
      playEnd: null,
      venueName: null,
      address: null,
      subGenre: null,
      description: null,
      poster: null,
    };
    try {
      const detailHtml = await fetchHtml(item.detailUrl);
      detail = parseDetail(detailHtml);
    } catch (e) {
      await logCrawlError(jobId, SOURCE_NAME, item.detailUrl, e);
      stats.errorCount++;
      errors.push({ url: item.detailUrl, step: "crawl", message: String(e) });
    }

    // 공연 시작일 필수(start_date NOT NULL). 상세에서 못 얻으면 스킵.
    if (!detail.playStart) {
      stats.eventsSkipped++;
      continue;
    }

    const rawInput = {
      sourceUrl: item.detailUrl,
      sourceName: SOURCE_NAME,
      title: item.title,
      posterUrl: detail.poster ?? item.listImage,
      venueName: detail.venueName,
      venueAddress: detail.address,
      startDate: detail.playStart,
      endDate: detail.playEnd ?? detail.playStart,
      ticketOpenDate: parseTicketOpen(item.ticketOpenRaw, detail.playStart),
      ticketProvider: "yanolja",
      ticketUrl: item.detailUrl,
      artists: [], // NOL 라인업 비제공 → enrich(Gemini)가 페스티벌 라인업 수집
      artistProfiles: [],
      genre: mapGenre(detail.subGenre),
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
