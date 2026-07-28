/**
 * 공연장 중복 탐지 API
 *
 * 탐지 방식:
 *   A. normalized_name 완전 일치
 *   B. 이름이 다른 이름을 포함 (예: "KSPO DOME" ↔ "KSPO DOME(올림픽체조경기장)")
 *   C. 토큰 자카드 유사도 ≥ 0.7
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { withErrorHandler } from "@/lib/api-handler";
import { geminiText } from "@/lib/gemini";
import {
  detectDuplicateCandidates,
  type VenueBasic,
  type VenueDedupCandidate,
} from "@/lib/venues/dedup-detect";

export const maxDuration = 60;

export const GET = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);

  const supabase = createClient();

  const { data: rawVenues } = await supabase
    .from("venues")
    .select("id,name,address,normalized_name")
    .limit(3000);

  if (!rawVenues || rawVenues.length === 0) {
    return NextResponse.json({ candidates: [], total: 0, byReason: {} });
  }

  const venues = rawVenues as unknown as VenueBasic[];

  // 이벤트 연결 수 조회
  const { data: eventLinks } = await supabase
    .from("events")
    .select("venue_id")
    .not("venue_id", "is", null);

  const linkedCountMap: Record<string, number> = {};
  for (const { venue_id } of eventLinks ?? []) {
    if (venue_id)
      linkedCountMap[venue_id] = (linkedCountMap[venue_id] ?? 0) + 1;
  }

  const allCandidates = detectDuplicateCandidates(venues, linkedCountMap);

  // Gemini 검증: 불확실한 후보(name_contains, token_overlap) 필터링
  const useAI = new URL(request.url).searchParams.get("ai") !== "false";
  let verified = allCandidates;
  if (useAI) {
    const highConf = allCandidates.filter(
      (c) => c.reason === "exact_normalized",
    );
    const lowConf = allCandidates.filter(
      (c) => c.reason === "name_contains" || c.reason === "token_overlap",
    );
    const verifiedLow: VenueDedupCandidate[] = [];
    for (let i = 0; i < lowConf.length; i += 30) {
      const batch = lowConf.slice(i, i + 30);
      const pairs = batch.map(
        (c, idx) => `${idx}: "${c.members[0].name}" vs "${c.members[1].name}"`,
      );
      const prompt = `아래는 중복 공연장 이름 쌍입니다. 같은 공연장이면 true, 다른 곳이면 false.
반드시 JSON 배열로만 응답하세요. 예: [true, false]

${pairs.join("\n")}`;
      try {
        const raw = await geminiText(prompt);
        const results: boolean[] = JSON.parse(
          raw.replace(/```json|```/g, "").trim(),
        );
        batch.forEach((c, idx) => {
          if (results[idx] !== false) verifiedLow.push(c);
        });
      } catch {
        verifiedLow.push(...batch);
      }
    }
    verified = [...highConf, ...verifiedLow];
  }

  const result = verified.slice(0, limit);
  const byReason = {
    exact_normalized: result.filter((c) => c.reason === "exact_normalized")
      .length,
    name_contains: result.filter((c) => c.reason === "name_contains").length,
    token_overlap: result.filter((c) => c.reason === "token_overlap").length,
  };

  return NextResponse.json({
    candidates: result,
    total: result.length,
    byReason,
  });
});
