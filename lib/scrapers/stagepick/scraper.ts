import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import { parseListPage, parseDetailPage } from "./parser";
import { normalizeEvent } from "@/lib/ingestion/normalize";
import { upsertEvent } from "@/lib/ingestion/upsert";
import { saveRawPayload, markRawPayloadProcessed } from "@/lib/crawler/job-manager";
import { logCrawlError, logParseError, logUpsertError } from "@/lib/crawler/error-logger";
import { RawScrapedEventSchema } from "@/types/ingestion";
import type { IngestionPipelineResult } from "@/types/ingestion";
import type { ScrapeOptions } from "@/lib/scrapers/base/adapter";

const SOURCE_NAME = "stagepick";
const LIST_URL = "https://www.stagepick.co.kr/festival";
const RATE_LIMIT_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithBrowser(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(1000); // JS 렌더링 대기
    return await page.content();
  } finally {
    await page.close();
  }
}

export async function scrapeList(browser: Browser): Promise<string[]> {
  const html = await fetchWithBrowser(browser, LIST_URL);
  const items = parseListPage(html);
  return items.map((i) => i.detailUrl);
}

export async function runStagepickScraper(
  jobId: string,
  options: ScrapeOptions = {},
): Promise<IngestionPipelineResult> {
  const start = Date.now();
  const { maxItems = 100, dryRun = false } = options;

  let browser: Browser | null = null;
  const stats = {
    pagesCrawled: 0,
    eventsFound: 0,
    eventsUpserted: 0,
    eventsSkipped: 0,
    errorCount: 0,
  };
  const errors: IngestionPipelineResult["errors"] = [];

  try {
    browser = await chromium.launch({ headless: true });

    // Step 1: 목록 크롤링
    let detailUrls: string[] = [];
    try {
      detailUrls = await scrapeList(browser);
      stats.pagesCrawled++;
    } catch (e) {
      await logCrawlError(jobId, SOURCE_NAME, LIST_URL, e);
      stats.errorCount++;
      errors.push({ url: LIST_URL, step: "crawl", message: String(e) });
    }

    const urls = detailUrls.slice(0, maxItems);
    stats.eventsFound = urls.length;

    // Step 2: 상세 페이지 순회
    for (const url of urls) {
      await sleep(RATE_LIMIT_MS);

      let html = "";
      try {
        html = await fetchWithBrowser(browser, url);
        stats.pagesCrawled++;
      } catch (e) {
        await logCrawlError(jobId, SOURCE_NAME, url, e);
        stats.errorCount++;
        errors.push({ url, step: "crawl", message: String(e) });
        continue;
      }

      // Step 3: 파싱
      let rawPayloadId: string | null = null;
      let parsed;
      try {
        const detail = parseDetailPage(html, url);
        const rawInput = {
          sourceUrl: url,
          sourceName: SOURCE_NAME,
          title: detail.title,
          posterUrl: detail.posterUrl,
          venueName: detail.venueName,
          venueAddress: detail.venueAddress,
          startDate: detail.dateRange,
          endDate: detail.dateRange,
          ticketOpenDate: detail.ticketOpenDate,
          ticketProvider: detail.ticketProvider,
          ticketUrl: detail.ticketUrl,
          artists: detail.artists,
          genre: detail.genre,
          description: detail.description,
          status: "upcoming" as const,
          rawHtml: dryRun ? null : html,
        };

        parsed = RawScrapedEventSchema.safeParse(rawInput);
        if (!parsed.success) {
          throw new Error(`Validation: ${parsed.error.message}`);
        }

        // Step 4: raw payload 저장
        if (!dryRun) {
          rawPayloadId = await saveRawPayload({
            jobId,
            sourceName: SOURCE_NAME,
            sourceUrl: url,
            rawHtml: dryRun ? null : html,
            parsedJson: rawInput as Record<string, unknown>,
          });
        }
      } catch (e) {
        await logParseError(jobId, SOURCE_NAME, url, e);
        stats.errorCount++;
        errors.push({ url, step: "parse", message: String(e) });
        continue;
      }

      if (dryRun) {
        stats.eventsSkipped++;
        continue;
      }

      // Step 5: 정규화 + upsert
      try {
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
        await logUpsertError(jobId, SOURCE_NAME, e);
        stats.errorCount++;
        errors.push({ url, step: "upsert", message: String(e) });
      }
    }
  } finally {
    await browser?.close();
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
