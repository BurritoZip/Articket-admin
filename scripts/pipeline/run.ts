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
  enrichEventArtists,
  enrichEventGenres,
  enrichEventAges,
  enrichEventTicketDates,
  enrichEventDescriptions,
  backfillEventPosters,
} from "../../lib/ingestion/event-enrich";
import { autoMergeDuplicateEvents } from "../../lib/ingestion/event-auto-merge";
import { autoPurgeNonConcerts } from "../../lib/data-quality/purge-non-concerts";
import { purgeOldEvents } from "../../lib/data-quality/purge-old-events";
import { purgeNonMusicArtistEvents } from "../../lib/data-quality/purge-non-music";
import { purgeUnlinkedEvents } from "../../lib/data-quality/purge-unlinked";
import { autoMergeExactArtists } from "../../lib/artists/auto-merge";
import { aiDedupArtists } from "../../lib/artists/ai-dedup";
import { geminiEnrichArtists } from "../../lib/artists/enrich/gemini-enrich";
import { autoMergeExactVenues } from "../../lib/venues/auto-merge";
import { runArtistBackfill } from "../../lib/ingestion/artist-backfill";
import { processVenueAddressEnrichment } from "../../lib/venues/enrich";
import { runYes24Scraper } from "../../lib/scrapers/yes24/scraper";
import { runMelonScraper } from "../../lib/scrapers/melon/scraper";
import { runInterparkScraper } from "../../lib/scrapers/interpark/scraper";
import { runFestivallifeScraper } from "../../lib/scrapers/festivallife/scraper";
import { runYanoljaScraper } from "../../lib/scrapers/yanolja/scraper";
import { runGeminiSearchScraper } from "../../lib/scrapers/gemini-search/scraper";
import {
  createCrawlerJob,
  finishCrawlerJob,
} from "../../lib/crawler/job-manager";
import { auditCrawlerJobArtists } from "../../lib/ingestion/artist-audit";
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import { runScoring } from "../../lib/scoring/run";
import {
  stepStart,
  stepDone,
  stepFailed,
  stepProgress,
  resetStalePipelineSteps,
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

  // 지난 실행이 중간에 죽어(노트북 취침 등) 남긴 좀비 running 단계 정리 → 자가치유
  const staleReset = await resetStalePipelineSteps();
  if (staleReset > 0) log(`⚠ 좀비 running 단계 ${staleReset}개 정리 후 시작`);

  // crawl — enabled sources from DB
  await run("crawl", async () => {
    const { data: sources } = await db
      .from("crawler_sources")
      .select("name")
      .eq("enabled", true);

    const SCRAPER_MAP: Record<
      string,
      (
        jobId: string,
        opts: { maxItems?: number; dryRun?: boolean },
      ) => Promise<unknown>
    > = {
      yes24: (id, opts) => runYes24Scraper(id, opts),
      melon: (id, opts) => runMelonScraper(id, opts),
      interpark: (id, opts) => runInterparkScraper(id, opts),
      festivallife: (id, opts) => runFestivallifeScraper(id, opts),
      yanolja: (id, opts) => runYanoljaScraper(id, opts),
      "gemini-search": (id, opts) => runGeminiSearchScraper(id, opts),
    };

    const results: Record<string, unknown> = {};

    for (const source of sources ?? []) {
      const scraper = SCRAPER_MAP[source.name];
      if (!scraper) {
        log(`  ${source.name}: TS 스크래퍼 없음 (스킵)`);
        continue;
      }

      const job = await createCrawlerJob(source.name);
      try {
        const result = (await scraper(job.id, { dryRun: false })) as {
          eventsFound: number;
          eventsUpserted: number;
          eventsSkipped: number;
          pagesCrawled: number;
          errorCount: number;
        };

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

  // sweep
  await run("sweep", () => sweepEventStatuses());

  // fix
  await run("fix", () => runDataQualityAutoFix({ scope: "all" }));

  // delete — 불량행 삭제 + 비콘서트(전시/뮤지컬/클래식 등) 자동 제거(최근 크롤분)
  await run("delete", async () => {
    const dq = await runDataQualityAutoDelete({});
    const nc = await autoPurgeNonConcerts({ maxItems: 300 });
    return {
      ...dq,
      nonConcertChecked: nc.checked,
      nonConcertDeleted: nc.deleted,
    };
  });

  // enrich — 직접 보강 (큐 우회), max 4.5min
  await run("enrich", async () => {
    // 1. raw_payload 기반 아티스트 backfill
    await runArtistBackfill({ limit: 500, dryRun: false });

    // 2. 아티스트 없는 이벤트 → Gemini로 제목에서 추출 + 장르/연령/주소 직접 보강
    const [artistR, genreR, ageR, venueR, ticketR, descR, posterR, artistQ] =
      await Promise.all([
        enrichEventArtists(200),
        enrichEventGenres(50),
        enrichEventAges(50),
        processVenueAddressEnrichment(60),
        enrichEventTicketDates(40), // 예매오픈/마감일 그라운딩 보강(점진 드레인)
        enrichEventDescriptions(40), // 설명 그라운딩 보강(CSR 소스 빈 설명 채움)
        backfillEventPosters(40), // 표지 없는 건 interpark CDN 에서 구성
        queueArtistEnrichment(),
      ]);
    const artistLinked = artistR.linked;

    // 2.5 Gemini 그라운딩 아티스트 보강 (description/occupation/country/name_en)
    const giArtist = await geminiEnrichArtists({ maxItems: 40 });

    // 3. 아티스트 프로필 보강 (namu/melon/naver/wikipedia) — 큐 기반
    const { count: artistPending } = await db
      .from("ai_processing_queue")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "artist")
      .eq("status", "pending");

    const deadline = Date.now() + 270_000;
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

  // merge — 자기치유(비음악 아티스트 이벤트 제거) + AI 아티스트 병합 + 이벤트 중복 병합
  await run("merge", async () => {
    const nonMusic = await purgeNonMusicArtistEvents(); // enrich가 검증한 비음악 정리
    const unlinked = await purgeUnlinkedEvents(); // 아티스트 연결 실패 이벤트 숨김
    const aiArtists = await aiDedupArtists({ apply: true });
    const artists = await autoMergeExactArtists();
    const venues = await autoMergeExactVenues();
    const events = await autoMergeDuplicateEvents(); // 아티스트 병합 후 이벤트 흡수
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

  // score — 인기/트렌드 점수 산출
  await run("score", () => runScoring());

  // purge — 오래된 종료 공연 소프트 숨김(하드삭제 아님, 앱 노출만 차단)
  await run("purge", () => purgeOldEvents());

  log("=== 파이프라인 완료 ===");
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
