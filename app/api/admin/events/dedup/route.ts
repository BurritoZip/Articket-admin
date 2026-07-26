import { requireAdmin } from "@/lib/supabase/require-admin";
import { findDuplicateEventGroups } from "@/lib/events/dedup";
import { withErrorHandler } from "@/lib/api-handler";
import { NextResponse } from "next/server";

export const maxDuration = 60;

export const GET = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);

  const candidates = await findDuplicateEventGroups({ limit });

  return NextResponse.json({
    candidates,
    total: candidates.length,
    byReason: {
      same_title_diff_day: candidates.filter(
        (c) => c.reason === "same_title_diff_day",
      ).length,
      same_artist_similar: candidates.filter(
        (c) => c.reason === "same_artist_similar",
      ).length,
    },
  });
});
