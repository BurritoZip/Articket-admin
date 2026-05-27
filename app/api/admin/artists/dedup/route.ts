import { requireAdmin } from "@/lib/supabase/require-admin";
import { findDuplicateGroups, type DedupReason } from "@/lib/artists/dedup";
import { withErrorHandler } from "@/lib/api-handler";
import { NextResponse } from "next/server";

export const GET = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);
  const minSimilarity = parseFloat(url.searchParams.get("minSimilarity") ?? "0.85");
  const reasonsParam = url.searchParams.get("reasons");
  const reasons = reasonsParam
    ? (reasonsParam.split(",") as DedupReason[])
    : undefined;

  const candidates = await findDuplicateGroups({ limit, minSimilarity });

  const filtered = reasons
    ? candidates.filter((c) => reasons.includes(c.reason))
    : candidates;

  return NextResponse.json({
    candidates: filtered,
    total: filtered.length,
    byReason: {
      exact_normalized: filtered.filter((c) => c.reason === "exact_normalized").length,
      alias_match:      filtered.filter((c) => c.reason === "alias_match").length,
      ko_en_pair:       filtered.filter((c) => c.reason === "ko_en_pair").length,
      token_overlap:    filtered.filter((c) => c.reason === "token_overlap").length,
    },
  });
});
