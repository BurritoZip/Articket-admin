import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { sweepEventStatuses } from "@/lib/db/status-sweeper";
import { runDataQualityAutoFix } from "@/lib/data-quality/auto-fix";
import { runDataQualityAutoDelete } from "@/lib/data-quality/auto-delete";
import { processArtistEnrichmentQueue } from "@/lib/artists/enrich";
import { autoMergeExactArtists } from "@/lib/artists/auto-merge";
import { autoMergeExactVenues } from "@/lib/venues/auto-merge";
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

export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  // sweep
  await run("sweep", () => sweepEventStatuses());

  // fix (all scope since manual trigger)
  await run("fix", () => runDataQualityAutoFix({ scope: "all" }));

  // delete
  await run("delete", () => runDataQualityAutoDelete({}));

  // enrich — drain until empty (max 4.5min), stepProgress per batch
  await run("enrich", async () => {
    const db = createServiceRoleClient();
    const { count: totalPending } = await db
      .from("ai_processing_queue")
      .select("id", { count: "exact", head: true })
      .eq("task_type", "clean_data")
      .eq("entity_type", "artist")
      .eq("status", "pending");

    const deadline = Date.now() + 270_000;
    let total = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      total_in_queue: totalPending ?? 0,
    };

    while (Date.now() < deadline) {
      const r = await processArtistEnrichmentQueue(10);
      total = {
        ...total,
        processed: total.processed + r.processed,
        succeeded: total.succeeded + r.succeeded,
        failed: total.failed + r.failed,
      };
      // 1.5초 폴링이 잡을 수 있도록 배치마다 DB 업데이트
      await stepProgress("enrich", total as Record<string, unknown>);
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
