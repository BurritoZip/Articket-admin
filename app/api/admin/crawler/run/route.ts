import { requireAdmin } from "@/lib/supabase/require-admin";
import { createCrawlerJob, finishCrawlerJob } from "@/lib/crawler/job-manager";
import { runStagepickScraper } from "@/lib/scrapers/stagepick/scraper";
import {
  auditCrawlerJobArtists,
  type ArtistAuditReport,
} from "@/lib/ingestion/artist-audit";
import { withErrorHandler } from "@/lib/api-handler";
import { NextResponse } from "next/server";

export const maxDuration = 300;

export const POST = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    source: string;
    maxItems?: number;
    dryRun?: boolean;
  };

  if (!body.source) {
    return NextResponse.json({ error: "source is required" }, { status: 400 });
  }

  const job = await createCrawlerJob(body.source);

  try {
    let result;
    switch (body.source) {
      case "stagepick":
        result = await runStagepickScraper(job.id, {
          maxItems: body.maxItems ?? 50,
          dryRun: body.dryRun ?? false,
          jobId: job.id,
        });
        break;
      default:
        await finishCrawlerJob(job.id, {
          status: "failed",
          pagesCrawled: 0,
          eventsFound: 0,
          eventsUpserted: 0,
          eventsSkipped: 0,
          errorCount: 1,
        });
        return NextResponse.json(
          { error: `Unknown source: ${body.source}` },
          { status: 400 },
        );
    }

    let artistAudit: ArtistAuditReport = {
      checkedCount: 0,
      missingCount: 0,
      issues: [],
    };
    if (!body.dryRun) {
      try {
        artistAudit = await auditCrawlerJobArtists(job.id);
      } catch (auditErr) {
        console.error(
          "[Crawler] auditCrawlerJobArtists 실패 (무시):",
          auditErr instanceof Error ? auditErr.message : auditErr,
        );
      }
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
        artistAudit: {
          checkedCount: artistAudit.checkedCount,
          missingCount: artistAudit.missingCount,
          issues: artistAudit.issues.slice(0, 20),
        },
      },
    });

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      result: {
        ...result,
        errorCount: totalErrorCount,
        artistAudit,
      },
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
    return NextResponse.json({ error: msg, jobId: job.id }, { status: 500 });
  }
});
