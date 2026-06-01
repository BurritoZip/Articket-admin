/**
 * StagePick 크롤링 + 파이프라인 실행 엔드포인트
 *
 * 로컬 launchd(trigger-python.sh)에서 curl로 호출.
 * CRON_SECRET 환경변수 설정 시 Authorization: Bearer <secret> 헤더 필요.
 */

import { createCrawlerJob, finishCrawlerJob } from "@/lib/crawler/job-manager";
import { runStagepickScraper } from "@/lib/scrapers/stagepick/scraper";
import { checkStructureChange } from "@/lib/crawler/structure-check";
import {
  auditCrawlerJobArtists,
  type ArtistAuditReport,
} from "@/lib/ingestion/artist-audit";
import { runDataQualityAutoFix } from "@/lib/data-quality/auto-fix";
import { runDataQualityAutoDelete } from "@/lib/data-quality/auto-delete";
import { processArtistEnrichmentQueue } from "@/lib/artists/enrich";
import {
  enrichEventArtists,
  enrichEventGenres,
  enrichEventAges,
} from "@/lib/ingestion/event-enrich";
import { sweepEventStatuses } from "@/lib/db/status-sweeper";
import { autoMergeExactArtists } from "@/lib/artists/auto-merge";
import { autoMergeExactVenues } from "@/lib/venues/auto-merge";
import { stepStart, stepDone, stepFailed } from "@/lib/db/pipeline-tracker";
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

  const source = "stagepick";
  const job = await createCrawlerJob(source);

  // crawl 스텝 pipeline_step_status 추적 시작
  await stepStart("crawl").catch(() => null);

  try {
    const result = await runStagepickScraper(job.id, {
      maxItems: 100,
      dryRun: false,
      jobId: job.id,
    });

    let artistAudit: ArtistAuditReport = {
      checkedCount: 0,
      missingCount: 0,
      issues: [],
    };
    try {
      artistAudit = await auditCrawlerJobArtists(job.id);
    } catch (auditErr) {
      console.error(
        "[Cron] auditCrawlerJobArtists 실패 (무시):",
        auditErr instanceof Error ? auditErr.message : auditErr,
      );
    }

    const totalErrorCount = result.errorCount + artistAudit.missingCount;
    const crawlStatus =
      result.eventsUpserted === 0 && result.eventsFound === 0
        ? "failed"
        : totalErrorCount > 0
          ? "partial"
          : "success";

    // crawl 스텝 완료 기록
    if (crawlStatus === "failed") {
      await stepFailed("crawl", `eventsFound=0`).catch(() => null);
    } else {
      await stepDone("crawl", {
        [source]: {
          eventsFound: result.eventsFound,
          eventsUpserted: result.eventsUpserted,
          errorCount: totalErrorCount,
        },
      }).catch(() => null);
    }

    const fixR = await track("fix", () =>
      runDataQualityAutoFix({ scope: "recent_1_days" }),
    );
    const autoFix = { fixed: fixR?.fixed ?? 0, queued: fixR?.queued ?? 0 };

    const delR = await track("delete", () => runDataQualityAutoDelete({}));
    const autoDelete = { deleted: delR?.deleted ?? 0 };

    const enrichR = await track("enrich", async () => {
      // 이벤트 직접 보강(아티스트/장르/연령) + 아티스트 프로필 큐 처리
      const [{ linked }, genreR, ageR, rArtist] = await Promise.all([
        enrichEventArtists(100),
        enrichEventGenres(50),
        enrichEventAges(50),
        processArtistEnrichmentQueue(20),
      ]);
      return {
        artistLinked: linked,
        genreFilled: genreR.filled,
        ageFilled: ageR.filled,
        succeeded: rArtist.succeeded,
        failed: rArtist.failed,
      };
    });
    const enrichQueue = {
      artistLinked: enrichR?.artistLinked ?? 0,
      genreFilled: enrichR?.genreFilled ?? 0,
      ageFilled: enrichR?.ageFilled ?? 0,
      succeeded: enrichR?.succeeded ?? 0,
      failed: enrichR?.failed ?? 0,
    };

    const sweepR = await track("sweep", () => sweepEventStatuses());
    const statusSweep = { updated: sweepR?.updated ?? 0 };

    const artistMergeR = await track("merge", () => autoMergeExactArtists());
    const artistMerge = { merged: artistMergeR?.merged ?? 0 };

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

    await finishCrawlerJob(job.id, {
      status: crawlStatus,
      pagesCrawled: result.pagesCrawled,
      eventsFound: result.eventsFound,
      eventsUpserted: result.eventsUpserted,
      eventsSkipped: result.eventsSkipped,
      errorCount: totalErrorCount,
      meta: {
        trigger: "cron",
        artistAudit: {
          checkedCount: artistAudit.checkedCount,
          missingCount: artistAudit.missingCount,
        },
        autoFix,
        autoDelete,
        enrichQueue,
        statusSweep,
        artistMerge,
        venueMerge,
      },
    });

    // 구조 변경 감지
    const structureCheck = await checkStructureChange({
      jobId: job.id,
      sourceName: source,
      eventsFound: result.eventsFound,
    }).catch((e) =>
      console.error(
        "[Cron] structure check 실패:",
        e instanceof Error ? e.message : e,
      ),
    );

    console.log(
      `[Cron] 완료 — 발견: ${result.eventsFound}, 저장: ${result.eventsUpserted}, 오류: ${totalErrorCount}`,
      structureCheck && "detected" in structureCheck && structureCheck.detected
        ? `⚠️ 구조 변경 감지 (연속 ${structureCheck.consecutiveZeroCount}회)`
        : "",
    );

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      eventsFound: result.eventsFound,
      eventsUpserted: result.eventsUpserted,
      errorCount: totalErrorCount,
    });
  } catch (e) {
    await finishCrawlerJob(job.id, {
      status: "failed",
      pagesCrawled: 0,
      eventsFound: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errorCount: 1,
    });
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Cron] 크롤링 실패:", msg);
    return NextResponse.json({ error: msg, jobId: job.id }, { status: 500 });
  }
}
