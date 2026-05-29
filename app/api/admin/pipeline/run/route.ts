import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { sweepEventStatuses } from "@/lib/db/status-sweeper";
import { runDataQualityAutoFix } from "@/lib/data-quality/auto-fix";
import { runDataQualityAutoDelete } from "@/lib/data-quality/auto-delete";
import { processArtistEnrichmentQueue } from "@/lib/artists/enrich";
import {
  processEventEnrichmentQueue,
  queueEventEnrichment,
} from "@/lib/ingestion/event-enrich";
import { autoMergeExactArtists } from "@/lib/artists/auto-merge";
import { autoMergeExactVenues } from "@/lib/venues/auto-merge";
import { createCrawlerJob, finishCrawlerJob } from "@/lib/crawler/job-manager";
import { runStagepickScraper } from "@/lib/scrapers/stagepick/scraper";
import { auditCrawlerJobArtists } from "@/lib/ingestion/artist-audit";
import {
  stepStart,
  stepDone,
  stepFailed,
  stepProgress,
} from "@/lib/db/pipeline-tracker";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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

type ScraperName = "stagepick";

const SCRAPERS: Record<
  ScraperName,
  (
    jobId: string,
    maxItems: number,
  ) => Promise<{
    pagesCrawled: number;
    eventsFound: number;
    eventsUpserted: number;
    eventsSkipped: number;
    errorCount: number;
  }>
> = {
  stagepick: (jobId, maxItems) =>
    runStagepickScraper(jobId, { maxItems, dryRun: false, jobId }),
};

export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const db = createServiceRoleClient();

  // crawl — enabled sources from DB
  await run("crawl", async () => {
    const { data: sources } = await db
      .from("crawler_sources")
      .select("name")
      .eq("enabled", true);

    const results: Record<string, unknown> = {};

    for (const source of sources ?? []) {
      const scraper = SCRAPERS[source.name as ScraperName];
      if (!scraper) continue;

      const job = await createCrawlerJob(source.name);
      try {
        const result = await scraper(job.id, 100);

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

  // enrich — queue events + drain all (artist + event), max 4.5min
  await run("enrich", async () => {
    // 보강 필요한 이벤트 큐 등록
    const { queued: eventQueued } = await queueEventEnrichment();

    const { count: totalPending } = await db
      .from("ai_processing_queue")
      .select("id", { count: "exact", head: true })
      .in("entity_type", ["artist", "event"])
      .eq("status", "pending");

    const deadline = Date.now() + 270_000;
    let total = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      total_in_queue: (totalPending ?? 0) + eventQueued,
    };

    while (Date.now() < deadline) {
      const [rArtist, rEvent] = await Promise.all([
        processArtistEnrichmentQueue(10),
        processEventEnrichmentQueue(10),
      ]);
      const batchProcessed = rArtist.processed + rEvent.processed;
      total = {
        ...total,
        processed: total.processed + batchProcessed,
        succeeded: total.succeeded + rArtist.succeeded + rEvent.succeeded,
        failed: total.failed + rArtist.failed + rEvent.failed,
      };
      await stepProgress("enrich", total as Record<string, unknown>);
      if (batchProcessed === 0) break;
    }
    return total;
  });

  // merge
  await run("merge", async () => {
    const artists = await autoMergeExactArtists();
    const venues = await autoMergeExactVenues();
    return { artists: artists.merged, venues: venues.merged };
  });

  return NextResponse.json({ ok: true });
}
