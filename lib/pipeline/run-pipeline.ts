/**
 * 파이프라인 단일 정의 (SINGLE SOURCE OF TRUTH)
 *
 * 예전엔 세 진입점(scripts/pipeline/run.ts, app/api/admin/pipeline/run, crawler/cron)이
 * 각자 8단계를 복붙해 갖고 있었다. 그 결과 단계 순서·scope·호출 함수가 서로 달라졌다:
 *   - cron 은 sweep 을 enrich 뒤에 두고, fix scope 가 recent_1_days 였으며, enrich 큐를 1회만 처리
 *   - UI route 는 autoPurgeNonConcerts / enrichEventTicketDates / geminiEnrichArtists /
 *     merge 하위작업(nonMusic·unlinked·aiDedup·eventMerge) 이 통째로 빠져 있었음
 *   - cron 은 resetStalePipelineSteps(좀비 정리)가 없었음
 *
 * 이제 8단계 로직은 여기 한 곳에만 있고, 세 진입점은 이 함수를 호출만 한다.
 * 환경 차이(큐 드레인 예산, 로깅)는 opts 로만 조절한다.
 */
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
  enrichEventTicketDates,
  enrichEventDescriptions,
  backfillEventPosters,
} from "@/lib/ingestion/event-enrich";
import { autoMergeDuplicateEvents } from "@/lib/ingestion/event-auto-merge";
import { autoPurgeNonConcerts } from "@/lib/data-quality/purge-non-concerts";
import { purgeOldEvents } from "@/lib/data-quality/purge-old-events";
import { purgeNonMusicArtistEvents } from "@/lib/data-quality/purge-non-music";
import { purgeUnlinkedEvents } from "@/lib/data-quality/purge-unlinked";
import { autoMergeExactArtists } from "@/lib/artists/auto-merge";
import { aiDedupArtists } from "@/lib/artists/ai-dedup";
import { geminiEnrichArtists } from "@/lib/artists/enrich/gemini-enrich";
import { autoMergeExactVenues } from "@/lib/venues/auto-merge";
import { runArtistBackfill } from "@/lib/ingestion/artist-backfill";
import { processVenueAddressEnrichment } from "@/lib/venues/enrich";
import { runYes24Scraper } from "@/lib/scrapers/yes24/scraper";
import { runMelonScraper } from "@/lib/scrapers/melon/scraper";
import { runInterparkScraper } from "@/lib/scrapers/interpark/scraper";
import { runFestivallifeScraper } from "@/lib/scrapers/festivallife/scraper";
import { runYanoljaScraper } from "@/lib/scrapers/yanolja/scraper";
import { runGeminiSearchScraper } from "@/lib/scrapers/gemini-search/scraper";
import { createCrawlerJob, finishCrawlerJob } from "@/lib/crawler/job-manager";
import { auditCrawlerJobArtists } from "@/lib/ingestion/artist-audit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runScoring } from "@/lib/scoring/run";
import {
  stepStart,
  stepDone,
  stepFailed,
  stepProgress,
  resetStalePipelineSteps,
  type PipelineStep,
} from "@/lib/db/pipeline-tracker";

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

export interface PipelineOptions {
  /** crawler_jobs.meta.trigger 에 남길 실행 출처 */
  trigger: "local-cron" | "pipeline" | "cron";
  /** enrich 큐 드레인 예산(ms). 서버리스는 maxDuration 여유를 고려해 짧게 준다. */
  enrichBudgetMs?: number;
  /** 진행 로그 콜백(로컬 스크립트만 사용) */
  log?: (msg: string) => void;
}

export type PipelineSummary = Record<PipelineStep, unknown>;

/** 8단계 전체 실행. 각 단계는 실패해도 다음 단계로 진행하고 결과를 summary 에 담는다. */
export async function runFullPipeline(
  opts: PipelineOptions,
): Promise<PipelineSummary> {
  const db = createServiceRoleClient();
  const log = opts.log ?? (() => {});
  const enrichBudgetMs = opts.enrichBudgetMs ?? 180_000;
  const summary = {} as PipelineSummary;

  const run = async <T>(step: PipelineStep, fn: () => Promise<T>) => {
    log(`▶ ${step} 시작`);
    await stepStart(step).catch(() => null);
    try {
      const result = await fn();
      await stepDone(step, result as Record<string, unknown>).catch(() => null);
      summary[step] = result;
      log(`✓ ${step} 완료`);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await stepFailed(step, msg).catch(() => null);
      summary[step] = { error: msg };
      log(`✗ ${step} 실패: ${msg}`);
      return null;
    }
  };

  // 지난 실행이 죽어 남긴 좀비 running 단계 정리(새 실행이 뒤엉키지 않게) → 자가치유
  const staleReset = await resetStalePipelineSteps().catch(() => 0);
  if (staleReset > 0) log(`⚠ 좀비 running 단계 ${staleReset}개 정리 후 시작`);

  // 1) crawl — enabled sources
  await run("crawl", async () => {
    const { data: sources } = await db
      .from("crawler_sources")
      .select("name")
      .eq("enabled", true);

    const results: Record<string, unknown> = {};
    for (const source of sources ?? []) {
      const scraper = SCRAPERS[source.name];
      if (!scraper) {
        log(`  ${source.name}: TS 스크래퍼 없음 (스킵)`);
        continue;
      }
      const job = await createCrawlerJob(source.name);
      try {
        const result = await scraper(job.id);

        // 소스별 아티스트 감사(마지막 잡만 보던 cron 버그 방지 — 잡마다 확인)
        let artistAudit = { checkedCount: 0, missingCount: 0 };
        try {
          const audit = await auditCrawlerJobArtists(job.id);
          artistAudit = {
            checkedCount: audit.checkedCount,
            missingCount: audit.missingCount,
          };
        } catch {
          /* 감사 실패는 크롤 자체를 실패로 보지 않는다 */
        }

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
          meta: { trigger: opts.trigger, artistAudit },
        });

        results[source.name] = {
          eventsFound: result.eventsFound,
          eventsUpserted: result.eventsUpserted,
          errorCount: totalErrors,
        };
        log(
          `  ${source.name}: 발견 ${result.eventsFound}, 저장 ${result.eventsUpserted}, 오류 ${totalErrors}`,
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

  // 2) sweep — end_date 기준 상태 갱신
  await run("sweep", () => sweepEventStatuses());

  // 3) fix — 이상 필드 자동 수정(전량 재검사)
  await run("fix", () => runDataQualityAutoFix({ scope: "all" }));

  // 4) delete — 불량행 삭제 + 비콘서트 정리
  await run("delete", async () => {
    const dq = await runDataQualityAutoDelete({});
    const nc = await autoPurgeNonConcerts({ maxItems: 300 });
    return {
      ...dq,
      nonConcertChecked: nc.checked,
      nonConcertDeleted: nc.deleted,
      heldRestored: nc.restored,
      heldStill: nc.stillHeld,
    };
  });

  // 5) enrich — 직접 보강(큐 우회) + 아티스트 큐 드레인
  await run("enrich", async () => {
    await runArtistBackfill({ limit: 500, dryRun: false });

    const [artistR, genreR, ageR, venueR, ticketR, descR, posterR, artistQ] =
      await Promise.all([
        enrichEventArtists(200),
        enrichEventGenres(50),
        enrichEventAges(50),
        processVenueAddressEnrichment(60),
        enrichEventTicketDates(40),
        enrichEventDescriptions(40),
        backfillEventPosters(40),
        queueArtistEnrichment(),
      ]);
    const artistLinked = artistR.linked;

    const giArtist = await geminiEnrichArtists({ maxItems: 40 });

    const { count: artistPending } = await db
      .from("ai_processing_queue")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "artist")
      .eq("status", "pending");

    const deadline = Date.now() + enrichBudgetMs;
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
      } as Record<string, unknown>).catch(() => null);
      if (r.processed === 0) break;
    }

    return {
      artist_linked: artistLinked,
      artist_multi: artistR.multiArtist,
      artist_none: artistR.noArtist,
      genre_filled: genreR.filled,
      age_filled: ageR.filled,
      venue_address_filled: venueR.filled,
      ticket_dates_filled: ticketR.filled,
      description_filled: descR.filled,
      poster_filled: posterR.filled,
      gemini_artist_filled: giArtist.filled,
      artist_enriched: succeeded,
      artist_failed: failed,
      processed,
    };
  });

  // 6) merge — 자기치유 + 아티스트/공연장/이벤트 병합
  await run("merge", async () => {
    const nonMusic = await purgeNonMusicArtistEvents();
    const unlinked = await purgeUnlinkedEvents();
    const aiArtists = await aiDedupArtists({ apply: true });
    const artists = await autoMergeExactArtists();
    const venues = await autoMergeExactVenues();
    const events = await autoMergeDuplicateEvents();
    return {
      nonMusicUnlinked: nonMusic.unlinked,
      nonMusicArtistsDeleted: nonMusic.artistsDeleted,
      unlinkedHidden: unlinked.hidden,
      unlinkedRestored: unlinked.unhidden,
      aiArtistsMerged: aiArtists.merged,
      artists: artists.merged,
      venues: venues.merged,
      eventDupsMerged: events.merged,
    };
  });

  // 7) score
  await run("score", () => runScoring());

  // 8) purge — 오래된 종료 공연 소프트 숨김
  await run("purge", () => purgeOldEvents());

  return summary;
}
