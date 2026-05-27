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

export const maxDuration = 60;

interface VenueBasic {
  id: string;
  name: string;
  address: string | null;
  normalized_name: string | null;
}

function normalizeVenueKey(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^가-힣ㄱ-㆏a-z0-9]/g, "")
    .trim();
}

function tokenizeVenue(s: string): string[] {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[()[\]{}（）]/g, " ")
    .split(/[\s\-·._/]+/)
    .map((t) => t.replace(/[^가-힣ㄱ-㆏a-z0-9]/g, ""))
    .filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of Array.from(setA)) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface VenueDedupCandidate {
  reason: "exact_normalized" | "name_contains" | "token_overlap";
  similarity: number;
  suggestedKeepId: string;
  members: Array<{
    id: string;
    name: string;
    address: string | null;
    linked_event_count: number;
  }>;
}

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

  const toMember = (v: VenueBasic) => ({
    id: v.id,
    name: v.name,
    address: v.address,
    linked_event_count: linkedCountMap[v.id] ?? 0,
  });

  const groups = new Map<string, VenueDedupCandidate>();

  const addGroup = (
    a: VenueBasic,
    b: VenueBasic,
    reason: VenueDedupCandidate["reason"],
    similarity: number,
  ) => {
    const key = [a.id, b.id].sort().join("|");
    if (groups.has(key)) return;
    const members = [toMember(a), toMember(b)].sort(
      (x, y) => y.linked_event_count - x.linked_event_count,
    );
    groups.set(key, {
      reason,
      similarity,
      suggestedKeepId: members[0].id,
      members,
    });
  };

  // ── Stage A: normalized_name 완전 일치 ──────────────────────────
  const normGroups = new Map<string, VenueBasic[]>();
  for (const v of venues) {
    const key = v.normalized_name
      ? normalizeVenueKey(v.normalized_name)
      : normalizeVenueKey(v.name);
    if (!key) continue;
    const g = normGroups.get(key) ?? [];
    g.push(v);
    normGroups.set(key, g);
  }
  for (const group of Array.from(normGroups.values())) {
    if (group.length > 1) {
      for (let i = 1; i < group.length; i++) {
        addGroup(group[0], group[i], "exact_normalized", 1.0);
      }
    }
  }

  // ── Stage B: 이름 포함 관계 ──────────────────────────────────────
  for (let i = 0; i < venues.length - 1; i++) {
    for (let j = i + 1; j < venues.length; j++) {
      const a = venues[i];
      const b = venues[j];
      const keyA = normalizeVenueKey(a.name);
      const keyB = normalizeVenueKey(b.name);
      if (keyA.length < 2 || keyB.length < 2) continue;
      const [shorter, longer] =
        keyA.length <= keyB.length ? [keyA, keyB] : [keyB, keyA];
      const [shortV, longV] = keyA.length <= keyB.length ? [a, b] : [b, a];
      if (longer.includes(shorter) && shorter.length / longer.length >= 0.5) {
        addGroup(
          longV,
          shortV,
          "name_contains",
          shorter.length / longer.length,
        );
      }
    }
  }

  // ── Stage C: 토큰 자카드 유사도 ≥ 0.7 ──────────────────────────
  const byLen = new Map<number, VenueBasic[]>();
  for (const v of venues) {
    const l = v.name.length;
    for (const d of [-1, 0, 1]) {
      const g = byLen.get(l + d) ?? [];
      if (!g.includes(v)) g.push(v);
      byLen.set(l + d, g);
    }
  }
  for (const [, group] of Array.from(byLen)) {
    for (let i = 0; i < group.length - 1; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const key = [a.id, b.id].sort().join("|");
        if (groups.has(key)) continue;
        const sim = jaccard(tokenizeVenue(a.name), tokenizeVenue(b.name));
        if (sim >= 0.7) addGroup(a, b, "token_overlap", sim);
      }
    }
  }

  const allCandidates = Array.from(groups.values()).sort((a, b) => {
    const reasonOrder = {
      exact_normalized: 0,
      name_contains: 1,
      token_overlap: 2,
    };
    if (reasonOrder[a.reason] !== reasonOrder[b.reason])
      return reasonOrder[a.reason] - reasonOrder[b.reason];
    return b.similarity - a.similarity;
  });

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
