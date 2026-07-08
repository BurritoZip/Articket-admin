import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { withErrorHandler } from "@/lib/api-handler";
import { sweepEventStatuses } from "@/lib/db/status-sweeper";
import { runDataQualityAutoFix } from "@/lib/data-quality/auto-fix";
import { runDataQualityAutoDelete } from "@/lib/data-quality/auto-delete";
import {
  processArtistEnrichmentQueue,
  queueArtistEnrichment,
} from "@/lib/artists/enrich";
import {
  enrichEventArtists,
  enrichEventGenres,
  enrichEventAges,
  enrichEventDescriptions,
  backfillEventPosters,
} from "@/lib/ingestion/event-enrich";
import { autoMergeExactArtists } from "@/lib/artists/auto-merge";
import { autoMergeExactVenues } from "@/lib/venues/auto-merge";
import { runArtistBackfill } from "@/lib/ingestion/artist-backfill";
import { processVenueAddressEnrichment } from "@/lib/venues/enrich";
import { createCrawlerJob, finishCrawlerJob } from "@/lib/crawler/job-manager";
import { runYes24Scraper } from "@/lib/scrapers/yes24/scraper";
import { runMelonScraper } from "@/lib/scrapers/melon/scraper";
import { runInterparkScraper } from "@/lib/scrapers/interpark/scraper";
import { runFestivallifeScraper } from "@/lib/scrapers/festivallife/scraper";
import { runYanoljaScraper } from "@/lib/scrapers/yanolja/scraper";
import { runGeminiSearchScraper } from "@/lib/scrapers/gemini-search/scraper";
import { auditCrawlerJobArtists } from "@/lib/ingestion/artist-audit";
import {
  stepStart,
  stepDone,
  stepFailed,
  stepProgress,
  resetStalePipelineSteps,
} from "@/lib/db/pipeline-tracker";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runScoring } from "@/lib/scoring/run";
import { purgeOldEvents } from "@/lib/data-quality/purge-old-events";

export const maxDuration = 300;

async function run<T>(
  step: Parameters<typeof stepStart>[0],
  fn: () => Promise<T>,
): Promise<T | null> {
  await stepStart(step);
  try {
    const result = await fn();
    await stepDone(step, result as Record<string, unknown>);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await stepFailed(step, msg);
    return null;
  }
}

type ScraperResult = {
  pagesCrawled: number;
  eventsFound: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errorCount: number;
};

const SCRAPERS: Record<string, (jobId: string) => Promise<ScraperResult>> = {
  yes24: (id) => runYes24Scraper(id, { dryRun: false }),
  melon: (id) => runMelonScraper(id, { dryRun: false }),
  interpark: (id) => runInterparkScraper(id, { dryRun: false }),
  festivallife: (id) => runFestivallifeScraper(id, { dryRun: false }),
  yanolja: (id) => runYanoljaScraper(id, { dryRun: false }),
  "gemini-search": (id) => runGeminiSearchScraper(id, { dryRun: false }),
};

export const POST = withErrorHandler(async () => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const db = createServiceRoleClient();

  // 이전 실행이 죽어 남긴 좀비 running 단계를 먼저 정리(새 실행이 뒤엉키지 않게).
  await resetStalePipelineSteps();

  // crawl — enabled sources from DB
  await run("crawl", async () => {
    const { data: sources } = await db
      .from("crawler_sources")
      .select("name")
      .eq("enabled", true);

    const results: Record<string, unknown> = {};

    for (const source of sources ?? []) {
      const scraper = SCRAPERS[source.name];
      if (!scraper) continue;

      const job = await createCrawlerJob(source.name);
      try {
        const result = await scraper(job.id);

        let artistAudit = { checkedCount: 0, missingCount: 0 };
        try {
          const audit = await auditCrawlerJobArtists(job.id);
          artistAudit = {
            checkedCount: audit.checkedCount,
            missingCount: audit.missingCount,
          };
        } catch {}

        const totalErrors = result.errorCount + artistAudit.missingCount;
        const status =
          result.eventsUpserted === 0 && result.eventsFound === 0
            ? "failed"
            : totalErrors > 0
              ? "partial"
              : "success";

        await finishCrawlerJob(job.id, {
          status,
          pagesCrawled: result.pagesCrawled,
          eventsFound: result.eventsFound,
          eventsUpserted: result.eventsUpserted,
          eventsSkipped: result.eventsSkipped,
          errorCount: totalErrors,
          meta: { trigger: "pipeline", artistAudit },
        });

        results[source.name] = {
          eventsFound: result.eventsFound,
          eventsUpserted: result.eventsUpserted,
          errorCount: totalErrors,
        };
      } catch (e) {
        await finishCrawlerJob(job.id, {
          status: "failed",
          pagesCrawled: 0,
          eventsFound: 0,
          eventsUpserted: 0,
          eventsSkipped: 0,
          errorCount: 1,
        });
        results[source.name] = {
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    return results;
  });

  // sweep
  await run("sweep", () => sweepEventStatuses());

  // fix (all scope since manual trigger)
  await run("fix", () => runDataQualityAutoFix({ scope: "all" }));

  // delete
  await run("delete", () => runDataQualityAutoDelete({}));

  // enrich — 직접 보강 (큐 우회), max 4.5min
  await run("enrich", async () => {
    // 1. raw_payload 기반 아티스트 backfill
    await runArtistBackfill({ limit: 500, dryRun: false });

    // 2. 아티스트 없는 이벤트 → Gemini로 제목에서 추출
    const [
      { linked: artistLinked },
      genreR,
      ageR,
      venueR,
      descR,
      posterR,
      artistQ,
    ] = await Promise.all([
      enrichEventArtists(100),
      enrichEventGenres(50),
      enrichEventAges(50),
      processVenueAddressEnrichment(30),
      enrichEventDescriptions(30),
      backfillEventPosters(30),
      queueArtistEnrichment(),
    ]);

    // 3. 아티스트 프로필 보강 (namu/melon/naver/wikipedia) — 큐 기반
    const { count: artistPending } = await db
      .from("ai_processing_queue")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "artist")
      .eq("status", "pending");

    const deadline = Date.now() + 180_000;
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    while (Date.now() < deadline) {
      const r = await processArtistEnrichmentQueue(10);
      processed += r.processed;
      succeeded += r.succeeded;
      failed += r.failed;
      await stepProgress("enrich", {
        artist_linked: artistLinked,
        genre_filled: genreR.filled,
        age_filled: ageR.filled,
        venue_address_filled: venueR.filled,
        artist_enriched: succeeded,
        total_in_queue: (artistPending ?? 0) + artistQ.queued,
      } as Record<string, unknown>);
      if (r.processed === 0) break;
    }

    return {
      artist_linked: artistLinked,
      genre_filled: genreR.filled,
      age_filled: ageR.filled,
      venue_address_filled: venueR.filled,
      description_filled: descR.filled,
      poster_filled: posterR.filled,
      artist_enriched: succeeded,
      artist_failed: failed,
    };
  });

  // merge
  await run("merge", async () => {
    const artists = await autoMergeExactArtists();
    const venues = await autoMergeExactVenues();
    return { artists: artists.merged, venues: venues.merged };
  });

  // score — 인기/트렌드 점수 산출 (merge 이후: 중복 제거된 아티스트 기준)
  await run("score", () => runScoring());

  // purge — 오래된 종료 공연 소프트 숨김(하드삭제 아님, 앱 노출만 차단)
  await run("purge", () => purgeOldEvents());

  return NextResponse.json({ ok: true });
});
