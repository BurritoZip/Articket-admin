import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { runDataQualityAutoDelete } from "@/lib/data-quality/auto-delete";

export const maxDuration = 120;

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
  const result = await runDataQualityAutoDelete({ dryRun: body.dryRun ?? false });

  return NextResponse.json({ ok: true, ...result });
}
