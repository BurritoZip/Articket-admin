/**
 * 로컬 파이프라인 실행 스크립트
 * trigger-python.sh에서 npx tsx scripts/pipeline/run.ts 로 호출
 * SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수 필요
 */

import { sweepEventStatuses } from "../../lib/db/status-sweeper";
import { runDataQualityAutoFix } from "../../lib/data-quality/auto-fix";
import { runDataQualityAutoDelete } from "../../lib/data-quality/auto-delete";
import {
  processArtistEnrichmentQueue,
  queueArtistEnrichment,
} from "../../lib/artists/enrich";
import {
  processEventEnrichmentQueue,
  queueEventEnrichment,
} from "../../lib/ingestion/event-enrich";
import { autoMergeExactArtists } from "../../lib/artists/auto-merge";
import { autoMergeExactVenues } from "../../lib/venues/auto-merge";
import { runStagepickScraper } from "../../lib/scrapers/stagepick/scraper";
import {
  createCrawlerJob,
  finishCrawlerJob,
} from "../../lib/crawler/job-manager";
import { auditCrawlerJobArtists } from "../../lib/ingestion/artist-audit";
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import {
  stepStart,
  stepDone,
  stepFailed,
  stepProgress,
} from "../../lib/db/pipeline-tracker";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

async function run<T>(
  step: Parameters<typeof stepStart>[0],
  fn: () => Promise<T>,
): Promise<T | null> {
  log(`▶ ${step} 시작`);
  await stepStart(step);
  try {
    const result = await fn();
    await stepDone(step, result as Record<string, unknown>);
    log(`✓ ${step} 완료`);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await stepFailed(step, msg);
    log(`✗ ${step} 실패: ${msg}`);
    return null;
  }
}

async function main() {
  log("=== 파이프라인 시작 ===");
  const db = createServiceRoleClient();

  // crawl — enabled sources from DB
  await run("crawl", async () => {
    const { data: sources } = await db
      .from("crawler_sources")
      .select("name")
      .eq("enabled", true);

    const results: Record<string, unknown> = {};

    for (const source of sources ?? []) {
      if (source.name !== "stagepick") continue; // TS 스크래퍼는 stagepick만

      const job = await createCrawlerJob(source.name);
      try {
        const result = await runStagepickScraper(job.id, {
          maxItems: 100,
          dryRun: false,
          jobId: job.id,
        });

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
          meta: { trigger: "local-cron", artistAudit },
        });

        results[source.name] = {
          eventsFound: result.eventsFound,
          eventsUpserted: result.eventsUpserted,
          errorCount: totalErrors,
        };
        log(
          `  stagepick: 발견 ${result.eventsFound}, 저장 ${result.eventsUpserted}, 오류 ${totalErrors}`,
        );
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

  // fix
  await run("fix", () => runDataQualityAutoFix({ scope: "all" }));

  // delete
  await run("delete", () => runDataQualityAutoDelete({}));

  // enrich
  await run("enrich", async () => {
    const [{ queued: artistQueued }, { queued: eventQueued }] =
      await Promise.all([queueArtistEnrichment(), queueEventEnrichment()]);
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
      total_in_queue: (totalPending ?? 0) + artistQueued + eventQueued,
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

  log("=== 파이프라인 완료 ===");
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
