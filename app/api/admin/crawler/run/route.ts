import { requireAdmin } from "@/lib/supabase/require-admin";
import { createCrawlerJob, finishCrawlerJob } from "@/lib/crawler/job-manager";
import { runStagepickScraper } from "@/lib/scrapers/stagepick/scraper";
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

    const status =
      result.errorCount > 0 && result.eventsUpserted === 0
        ? "failed"
        : result.errorCount > 0
          ? "partial"
          : "success";

    await finishCrawlerJob(job.id, {
      status,
      pagesCrawled: result.pagesCrawled,
      eventsFound: result.eventsFound,
      eventsUpserted: result.eventsUpserted,
      eventsSkipped: result.eventsSkipped,
      errorCount: result.errorCount,
    });

    return NextResponse.json({ ok: true, jobId: job.id, result });
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
