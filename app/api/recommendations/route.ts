import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-handler";
import { requireUser } from "@/lib/recommendations/auth";
import { computeRecommendations } from "@/lib/recommendations/score";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// 유저용 공개 엔드포인트 (admin 아님) — iOS 앱이 세션 JWT로 호출
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withErrorHandler(async (request) => {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const qUser = url.searchParams.get("userId");
  if (qUser && qUser !== auth.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  const db = createServiceRoleClient();
  const result = await computeRecommendations(auth.userId, { limit, offset, db });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
});
