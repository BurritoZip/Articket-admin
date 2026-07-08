import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { withErrorHandler } from "@/lib/api-handler";
import { sweepEventStatuses } from "@/lib/db/status-sweeper";

export const maxDuration = 60;

export const POST = withErrorHandler(async () => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const result = await sweepEventStatuses();
  return NextResponse.json({ ok: true, ...result });
});
