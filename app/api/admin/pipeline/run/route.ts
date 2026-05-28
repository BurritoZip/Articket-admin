import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { sweepEventStatuses } from "@/lib/db/status-sweeper";
import { runDataQualityAutoFix } from "@/lib/data-quality/auto-fix";
import { runDataQualityAutoDelete } from "@/lib/data-quality/auto-delete";
import { processArtistEnrichmentQueue } from "@/lib/artists/enrich";
import { autoMergeExactArtists } from "@/lib/artists/auto-merge";
import { autoMergeExactVenues } from "@/lib/venues/auto-merge";
import { stepStart, stepDone, stepFailed } from "@/lib/db/pipeline-tracker";

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

export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  // sweep
  await run("sweep", () => sweepEventStatuses());

  // fix (all scope since manual trigger)
  await run("fix", () => runDataQualityAutoFix({ scope: "all" }));

  // delete
  await run("delete", () => runDataQualityAutoDelete({}));

  // enrich — drain until empty (max 4.5min)
  await run("enrich", async () => {
    const deadline = Date.now() + 270_000;
    let total = { processed: 0, succeeded: 0, failed: 0 };
    while (Date.now() < deadline) {
      const r = await processArtistEnrichmentQueue(50);
      total = {
        processed: total.processed + r.processed,
        succeeded: total.succeeded + r.succeeded,
        failed: total.failed + r.failed,
      };
      if (r.processed === 0) break;
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
