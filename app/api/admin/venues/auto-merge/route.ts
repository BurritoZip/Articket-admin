import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { autoMergeExactVenues } from "@/lib/venues/auto-merge";

export const maxDuration = 120;

export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const result = await autoMergeExactVenues();
  return NextResponse.json({ ok: true, ...result });
}
