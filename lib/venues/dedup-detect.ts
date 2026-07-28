export interface VenueBasic {
  id: string;
  name: string;
  address: string | null;
  normalized_name: string | null;
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

/** AI 검증 이전의 중복 후보쌍 생성 (Stage A: 정규화 완전일치, B: 이름 포함, C: 토큰 자카드 ≥ 0.7) */
export function detectDuplicateCandidates(
  venues: VenueBasic[],
  linkedCountMap: Record<string, number>,
): VenueDedupCandidate[] {
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

  // ── Stage A: normalized_name 완전 일치 ──
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

  // ── Stage B: 이름 포함 관계 ──
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
        addGroup(longV, shortV, "name_contains", shorter.length / longer.length);
      }
    }
  }

  // ── Stage C: 토큰 자카드 유사도 ≥ 0.7 ──
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

  const reasonOrder = { exact_normalized: 0, name_contains: 1, token_overlap: 2 };
  return Array.from(groups.values()).sort((a, b) => {
    if (reasonOrder[a.reason] !== reasonOrder[b.reason])
      return reasonOrder[a.reason] - reasonOrder[b.reason];
    return b.similarity - a.similarity;
  });
}
