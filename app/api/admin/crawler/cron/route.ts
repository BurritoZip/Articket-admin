/**
 * 멀티소스 크롤링 + 파이프라인 실행 엔드포인트
 *
 * 로컬 launchd(trigger-python.sh)에서 curl로 호출.
 * CRON_SECRET 환경변수 설정 시 Authorization: Bearer <secret> 헤더 필요.
 */

import { createCrawlerJob, finishCrawlerJob } from "@/lib/crawler/job-manager";
import { runYes24Scraper } from "@/lib/scrapers/yes24/scraper";
import { runMelonScraper } from "@/lib/scrapers/melon/scraper";
import { runInterparkScraper } from "@/lib/scrapers/interpark/scraper";
import { runFestivallifeScraper } from "@/lib/scrapers/festivallife/scraper";
import { runYanoljaScraper } from "@/lib/scrapers/yanolja/scraper";
import { runGeminiSearchScraper } from "@/lib/scrapers/gemini-search/scraper";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  auditCrawlerJobArtists,
  type ArtistAuditReport,
} from "@/lib/ingestion/artist-audit";
import { runDataQualityAutoFix } from "@/lib/data-quality/auto-fix";
import { runDataQualityAutoDelete } from "@/lib/data-quality/auto-delete";
import { autoPurgeNonConcerts } from "@/lib/data-quality/purge-non-concerts";
import { processArtistEnrichmentQueue } from "@/lib/artists/enrich";
import {
  enrichEventArtists,
  enrichEventGenres,
  enrichEventAges,
  enrichEventTicketDates,
  enrichEventDescriptions,
} from "@/lib/ingestion/event-enrich";
import { autoMergeDuplicateEvents } from "@/lib/ingestion/event-auto-merge";
import { sweepEventStatuses } from "@/lib/db/status-sweeper";
import { autoMergeExactArtists } from "@/lib/artists/auto-merge";
import { aiDedupArtists } from "@/lib/artists/ai-dedup";
import { geminiEnrichArtists } from "@/lib/artists/enrich/gemini-enrich";
import { purgeNonMusicArtistEvents } from "@/lib/data-quality/purge-non-music";
import { purgeUnlinkedEvents } from "@/lib/data-quality/purge-unlinked";
import { autoMergeExactVenues } from "@/lib/venues/auto-merge";
import { processVenueAddressEnrichment } from "@/lib/venues/enrich";
import { stepStart, stepDone, stepFailed } from "@/lib/db/pipeline-tracker";
import { runScoring } from "@/lib/scoring/run";
import { purgeOldEvents } from "@/lib/data-quality/purge-old-events";
import { NextResponse, type NextRequest } from "next/server";

async function track<T>(
  step: Parameters<typeof stepStart>[0],
  fn: () => Promise<T>,
): Promise<T | null> {
  await stepStart(step).catch(() => null);
  try {
    const r = await fn();
    await stepDone(step, r as Record<string, unknown>).catch(() => null);
    return r;
  } catch (e) {
    await stepFailed(step, e instanceof Error ? e.message : String(e)).catch(
      () => null,
    );
    return null;
  }
}

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Vercel Cron 인증 확인
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceRoleClient();

  const SCRAPER_MAP: Record<
    string,
    (jobId: string) => Promise<{
      eventsFound: number;
      eventsUpserted: number;
      eventsSkipped: number;
      pagesCrawled: number;
      errorCount: number;
    }>
  > = {
    yes24: (id) => runYes24Scraper(id, { dryRun: false }),
    melon: (id) => runMelonScraper(id, { dryRun: false }),
    interpark: (id) => runInterparkScraper(id, { dryRun: false }),
    festivallife: (id) => runFestivallifeScraper(id, { dryRun: false }),
    yanolja: (id) => runYanoljaScraper(id, { dryRun: false }),
    "gemini-search": (id) => runGeminiSearchScraper(id, { dryRun: false }),
  };

  // crawl 스텝 pipeline_step_status 추적 시작
  await stepStart("crawl").catch(() => null);

  // enabled sources 조회 후 각 스크래퍼 순차 실행
  const { data: enabledSources } = await db
    .from("crawler_sources")
    .select("name")
    .eq("enabled", true);

  const crawlResults: Record<string, unknown> = {};
  let totalEventsFound = 0;
  let totalEventsUpserted = 0;
  let totalErrorCount = 0;
  let lastJobId = "";
  let artistAudit: ArtistAuditReport = {
    checkedCount: 0,
    missingCount: 0,
    issues: [],
  };

  try {
    for (const src of enabledSources ?? []) {
      const scraper = SCRAPER_MAP[src.name];
      if (!scraper) continue;

      const job = await createCrawlerJob(src.name);
      lastJobId = job.id;
      try {
        const result = await scraper(job.id);
        const srcErrors = result.errorCount;
        const srcStatus =
          result.eventsUpserted === 0 && result.eventsFound === 0
            ? "failed"
            : srcErrors > 0
              ? "partial"
              : "success";
        await finishCrawlerJob(job.id, {
          status: srcStatus,
          pagesCrawled: result.pagesCrawled,
          eventsFound: result.eventsFound,
          eventsUpserted: result.eventsUpserted,
          eventsSkipped: result.eventsSkipped,
          errorCount: srcErrors,
          meta: { trigger: "cron" },
        });
        totalEventsFound += result.eventsFound;
        totalEventsUpserted += result.eventsUpserted;
        totalErrorCount += srcErrors;
        crawlResults[src.name] = {
          eventsFound: result.eventsFound,
          eventsUpserted: result.eventsUpserted,
          errorCount: srcErrors,
        };
        console.log(
          `[Cron] ${src.name}: 발견 ${result.eventsFound}, 저장 ${result.eventsUpserted}`,
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
        totalErrorCount++;
        crawlResults[src.name] = {
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    try {
      artistAudit = await auditCrawlerJobArtists(lastJobId || "");
      totalErrorCount += artistAudit.missingCount;
    } catch (auditErr) {
      console.error(
        "[Cron] auditCrawlerJobArtists 실패 (무시):",
        auditErr instanceof Error ? auditErr.message : auditErr,
      );
    }

    const crawlStatus =
      totalEventsUpserted === 0 && totalEventsFound === 0
        ? enabledSources?.length === 0
          ? "success"
          : "failed"
        : totalErrorCount > 0
          ? "partial"
          : "success";

    // crawl 스텝 완료 기록
    if (crawlStatus === "failed") {
      await stepFailed("crawl", `eventsFound=0`).catch(() => null);
    } else {
      await stepDone("crawl", crawlResults).catch(() => null);
    }

    const fixR = await track("fix", () =>
      runDataQualityAutoFix({ scope: "recent_1_days" }),
    );
    const autoFix = { fixed: fixR?.fixed ?? 0, queued: fixR?.queued ?? 0 };

    const delR = await track("delete", async () => {
      const dq = await runDataQualityAutoDelete({});
      const nc = await autoPurgeNonConcerts({ maxItems: 300 });
      return { deleted: dq.deleted, nonConcertDeleted: nc.deleted };
    });
    const autoDelete = {
      deleted: delR?.deleted ?? 0,
      nonConcertDeleted: delR?.nonConcertDeleted ?? 0,
    };

    const enrichR = await track("enrich", async () => {
      // 이벤트 직접 보강(아티스트/장르/연령) + 아티스트 프로필 큐 처리
      const [artistR, genreR, ageR, venueR, ticketR, descR, giArtist, rArtist] =
        await Promise.all([
          enrichEventArtists(200),
          enrichEventGenres(50),
          enrichEventAges(50),
          processVenueAddressEnrichment(60),
          enrichEventTicketDates(40),
          enrichEventDescriptions(40),
          geminiEnrichArtists({ maxItems: 40 }), // Gemini 그라운딩 아티스트 정보
          processArtistEnrichmentQueue(20),
        ]);
      return {
        artistLinked: artistR.linked,
        artistMulti: artistR.multiArtist,
        artistNone: artistR.noArtist,
        genreFilled: genreR.filled,
        ageFilled: ageR.filled,
        venueAddressFilled: venueR.filled,
        ticketDatesFilled: ticketR.filled,
        descriptionFilled: descR.filled,
        geminiArtistFilled: giArtist.filled,
        succeeded: rArtist.succeeded,
        failed: rArtist.failed,
      };
    });
    const enrichQueue = {
      artistLinked: enrichR?.artistLinked ?? 0,
      artistMulti: enrichR?.artistMulti ?? 0,
      artistNone: enrichR?.artistNone ?? 0,
      genreFilled: enrichR?.genreFilled ?? 0,
      ageFilled: enrichR?.ageFilled ?? 0,
      venueAddressFilled: enrichR?.venueAddressFilled ?? 0,
      succeeded: enrichR?.succeeded ?? 0,
      failed: enrichR?.failed ?? 0,
    };

    const sweepR = await track("sweep", () => sweepEventStatuses());
    const statusSweep = { updated: sweepR?.updated ?? 0 };

    const artistMergeR = await track("merge", async () => {
      const nonMusic = await purgeNonMusicArtistEvents(); // 자기치유: 비음악 정리
      const unlinked = await purgeUnlinkedEvents(); // 아티스트 연결 실패 제거
      const ai = await aiDedupArtists({ apply: true }); // 음역·오타
      const a = await autoMergeExactArtists();
      const ev = await autoMergeDuplicateEvents(); // 아티스트 병합 후 이벤트 흡수
      return {
        merged: a.merged,
        aiMerged: ai.merged,
        eventDupsMerged: ev.deleted,
        nonMusicUnlinked: nonMusic.unlinked,
        nonMusicArtistsDeleted: nonMusic.artistsDeleted,
        unlinkedDeleted: unlinked.deleted,
      };
    });
    const artistMerge = {
      merged: artistMergeR?.merged ?? 0,
      aiMerged: artistMergeR?.aiMerged ?? 0,
      eventDupsMerged: artistMergeR?.eventDupsMerged ?? 0,
    };

    let venueMerge = { merged: 0 };
    try {
      venueMerge = await autoMergeExactVenues();
      console.log(`[Cron] VenueAutoMerge — 병합: ${venueMerge.merged}`);
    } catch (vMergeErr) {
      console.error(
        "[Cron] VenueAutoMerge 실패 (무시):",
        vMergeErr instanceof Error ? vMergeErr.message : vMergeErr,
      );
    }

    // score — 인기/트렌드 점수 산출
    const scoreR = await track("score", () => runScoring());
    const scoring = {
      artistScored: scoreR?.artist_scored ?? 0,
      concertScored: scoreR?.concert_scored ?? 0,
    };

    // purge — 오래된 종료 공연 소프트 숨김(하드삭제 아님, 앱 노출만 차단)
    const purgeR = await track("purge", () => purgeOldEvents());
    const purge = { hidden: purgeR?.hidden ?? 0 };

    console.log(
      `[Cron] 완료 — 발견: ${totalEventsFound}, 저장: ${totalEventsUpserted}, 오류: ${totalErrorCount}`,
    );

    return NextResponse.json({
      ok: true,
      crawlResults,
      eventsFound: totalEventsFound,
      eventsUpserted: totalEventsUpserted,
      errorCount: totalErrorCount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Cron] 파이프라인 실패:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
