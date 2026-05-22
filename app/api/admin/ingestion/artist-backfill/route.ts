import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-handler";
import { runArtistBackfill } from "@/lib/ingestion/artist-backfill";
import { requireAdmin } from "@/lib/supabase/require-admin";

export const POST = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    dryRun?: boolean;
  };

  const result = await runArtistBackfill({
    limit: body.limit,
    dryRun: body.dryRun,
  });

  return NextResponse.json({ ok: true, result });
});
