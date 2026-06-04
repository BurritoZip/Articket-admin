import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-handler";
import { requireAdmin } from "@/lib/supabase/require-admin";
import {
  ARTIST_REC_WEIGHTS,
  computeArtistRecommendations,
  computePopularArtists,
} from "@/lib/recommendations/artist-recs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// 관리자 미리보기 — 인기 아티스트 + (userId 지정 시) 그 유저의 좋아할만한 아티스트
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId")?.trim() || null;

  const db = createServiceRoleClient();
  const popular = await computePopularArtists(db, 30);

  let forYou: Awaited<
    ReturnType<typeof computeArtistRecommendations>
  >["items"] = [];
  let coldStart = false;
  if (userId) {
    const rec = await computeArtistRecommendations(db, userId, 30);
    forYou = rec.items;
    coldStart = rec.coldStart;
  }

  return NextResponse.json({
    weights: ARTIST_REC_WEIGHTS,
    popular,
    forYou,
    forYouColdStart: coldStart,
    previewUserId: userId,
  });
});
