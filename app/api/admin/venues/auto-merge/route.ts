import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { withErrorHandler } from "@/lib/api-handler";
import { autoMergeExactVenues } from "@/lib/venues/auto-merge";

export const maxDuration = 120;

export const POST = withErrorHandler(async () => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const result = await autoMergeExactVenues();
  return NextResponse.json({ ok: true, ...result });
});
