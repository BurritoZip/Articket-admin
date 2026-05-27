/**
 * Vercel Cron 엔드포인트 — 매시간 StagePick 크롤링 자동 실행
 *
 * vercel.json crons 설정:
 *   { "path": "/api/admin/crawler/cron", "schedule": "0 * * * *" }
 *
 * 인증: Vercel이 자동으로 CRON_SECRET을 Authorization 헤더에 포함해 호출.
 *   환경변수 CRON_SECRET 설정 필요.
 *   https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
 */

import { createCrawlerJob, finishCrawlerJob } from "@/lib/crawler/job-manager";
import { runStagepickScraper } from "@/lib/scrapers/stagepick/scraper";
import {
  auditCrawlerJobArtists,
  type ArtistAuditReport,
} from "@/lib/ingestion/artist-audit";
import { NextResponse, type NextRequest } from "next/server";

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
    const status =
      result.eventsUpserted === 0 && result.eventsFound === 0
        ? "failed"
        : totalErrorCount > 0
          ? "partial"
          : "success";

    await finishCrawlerJob(job.id, {
      status,
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
      },
    });

    console.log(
      `[Cron] 완료 — 발견: ${result.eventsFound}, 저장: ${result.eventsUpserted}, 오류: ${totalErrorCount}`,
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
