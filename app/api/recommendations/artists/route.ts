import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-handler";
import { requireUser } from "@/lib/recommendations/auth";
import {
  computeArtistRecommendations,
  computePopularArtists,
  type RecommendedArtist,
} from "@/lib/recommendations/artist-recs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// 유저용 공개 엔드포인트 (admin 아님) — iOS 아티스트 탭이 호출.
// 인기 아티스트는 비로그인도 조회 가능. forYou는 Authorization Bearer 있을 때만 개인화.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withErrorHandler(async (request) => {
  const url = new URL(request.url);
  const popularLimit = Math.min(
    50,
    Math.max(
      1,
      parseInt(url.searchParams.get("popularLimit") ?? "20", 10) || 20,
    ),
  );
  const forYouLimit = Math.min(
    50,
    Math.max(
      1,
      parseInt(url.searchParams.get("forYouLimit") ?? "20", 10) || 20,
    ),
  );

  // 토큰이 있으면 검증(잘못된 토큰은 401), 없으면 익명 처리.
  const hasAuthHeader = (request.headers.get("authorization") ?? "").startsWith(
    "Bearer ",
  );
  let userId: string | null = null;
  if (hasAuthHeader) {
    const auth = await requireUser(request);
    if (!auth.ok) return auth.response;
    userId = auth.userId;
    const qUser = url.searchParams.get("userId");
    if (qUser && qUser !== userId)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = createServiceRoleClient();

  const popular = await computePopularArtists(db, popularLimit);

  let forYou: RecommendedArtist[] = [];
  let forYouColdStart = false;
  if (userId) {
    const rec = await computeArtistRecommendations(db, userId, forYouLimit);
    forYouColdStart = rec.coldStart;
    // 팔로우 없음 → 인기 아티스트로 폴백 (섹션 비지 않게)
    forYou = rec.coldStart
      ? popular.slice(0, forYouLimit).map((p) => ({
          artistId: p.artistId,
          name: p.name,
          avatarUrl: p.avatarUrl,
          label: p.label,
          followersCount: p.followersCount,
          upcomingEventCount: p.upcomingEventCount,
          popularityScore: p.popularityScore,
          score: 0,
          breakdown: { coPerformer: 0, agency: 0, genre: 0 },
          reasons: ["지금 인기 있는 아티스트"],
        }))
      : rec.items;
  }

  // 공개 응답 — 팔로워수/인지도 점수 등 운영 지표는 제외(admin 전용).
  // iOS에는 순위·이름·아바타·공연수·추천이유만 노출한다.
  const result = {
    generatedAt: new Date().toISOString(),
    popular: popular.map((p) => ({
      artistId: p.artistId,
      name: p.name,
      avatarUrl: p.avatarUrl,
      upcomingEventCount: p.upcomingEventCount,
      rank: p.rank,
    })),
    forYou: forYou.map((a) => ({
      artistId: a.artistId,
      name: a.name,
      avatarUrl: a.avatarUrl,
      upcomingEventCount: a.upcomingEventCount,
      reasons: a.reasons,
    })),
    forYouColdStart,
  };

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": userId ? "private, max-age=60" : "public, max-age=120",
    },
  });
});
