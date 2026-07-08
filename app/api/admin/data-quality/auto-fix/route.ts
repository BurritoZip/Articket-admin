import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { withErrorHandler } from "@/lib/api-handler";
import {
  runDataQualityAutoFix,
  type AutoFixOptions,
} from "@/lib/data-quality/auto-fix";

export const maxDuration = 120;

export const POST = withErrorHandler(async (request: Request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as {
    scope?: AutoFixOptions["scope"];
    dryRun?: boolean;
  };

  const scope = body.scope ?? "recent_1_days";
  const dryRun = body.dryRun ?? false;

  const result = await runDataQualityAutoFix({ scope, dryRun });

  return NextResponse.json({ ok: true, dryRun, scope, ...result });
});
