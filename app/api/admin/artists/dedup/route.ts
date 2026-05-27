import { requireAdmin } from "@/lib/supabase/require-admin";
import { findDuplicateGroups, type DedupCandidate, type DedupReason } from "@/lib/artists/dedup";
import { withErrorHandler } from "@/lib/api-handler";
import { geminiText } from "@/lib/gemini";
import { NextResponse } from "next/server";

/**
 * Gemini로 후보 쌍 검증
 * "이 두 이름이 같은 아티스트인가?" → true/false
 * 확신하기 어려우면 true(검토 필요)로 남김
 */
async function geminiVerify(candidates: DedupCandidate[]): Promise<DedupCandidate[]> {
  if (candidates.length === 0) return [];

  const pairs = candidates.map((c, i) => {
    const [a, b] = c.members;
    return `${i}: "${a.name}" vs "${b.name}"`;
  });

  const prompt = `아래는 중복일 가능성이 있는 아티스트 이름 쌍 목록입니다.
각 쌍에 대해 "같은 아티스트인가?"를 판단하세요.
- 한국어 이름과 영어 이름이 같은 사람일 수 있습니다 (예: "아이유"↔"IU", "방탄소년단"↔"BTS").
- 확실히 다른 사람이면 false, 같은 사람이거나 불확실하면 true.
- 반드시 JSON 배열로만 응답하세요. 예: [true, false, true]

쌍 목록:
${pairs.join("\n")}`;

  try {
    const raw = await geminiText(prompt);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const results: boolean[] = JSON.parse(cleaned);
    return candidates.filter((_, i) => results[i] !== false);
  } catch {
    // Gemini 실패 시 원본 그대로 반환 (FP 허용이 FN보다 낫다)
    return candidates;
  }
}

export const maxDuration = 60;

export const GET = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);
  const minSimilarity = parseFloat(url.searchParams.get("minSimilarity") ?? "0.85");
  const useAI = url.searchParams.get("ai") !== "false"; // 기본 true
  const reasonsParam = url.searchParams.get("reasons");
  const reasons = reasonsParam
    ? (reasonsParam.split(",") as DedupReason[])
    : undefined;

  const candidates = await findDuplicateGroups({ limit, minSimilarity });

  let filtered = reasons
    ? candidates.filter((c) => reasons.includes(c.reason))
    : candidates;

  // Gemini 검증: token_overlap, name_contains는 FP 가능성이 높으므로 AI 필터링
  if (useAI) {
    const highConf = filtered.filter(
      (c) => c.reason === "exact_normalized" || c.reason === "alias_match",
    );
    const lowConf = filtered.filter(
      (c) => c.reason === "token_overlap" || c.reason === "name_contains",
    );
    // 30쌍씩 배치 처리
    const verifiedLowConf: DedupCandidate[] = [];
    for (let i = 0; i < lowConf.length; i += 30) {
      const batch = lowConf.slice(i, i + 30);
      const verified = await geminiVerify(batch);
      verifiedLowConf.push(...verified);
    }
    filtered = [...highConf, ...verifiedLowConf];
  }

  return NextResponse.json({
    candidates: filtered,
    total: filtered.length,
    byReason: {
      exact_normalized: filtered.filter((c) => c.reason === "exact_normalized").length,
      alias_match: filtered.filter((c) => c.reason === "alias_match").length,
      token_overlap: filtered.filter((c) => c.reason === "token_overlap").length,
      name_contains: filtered.filter((c) => c.reason === "name_contains").length,
    },
  });
});
