/**
 * 아티스트 중복 후보 탐지
 *
 * 4가지 stage로 중복 그룹을 탐지한다:
 *   A. normalized_name 완전 일치
 *   B. artist_aliases ↔ name/name_en 교차 매칭
 *   C. 같은 이벤트에 등장하는 한/영 이름 쌍
 *   D. 토큰 자카드 유사도 ≥ 0.85 (동일 언어 그룹)
 *
 * 모든 머지는 관리자가 수동으로 confirm — 자동 머지 없음.
 */

import { createClient } from "@/lib/supabase/server";
import {
  normalizeKey,
  isKoreanOnly,
  isLatinOnly,
  isNonKorean,
  tokenize,
  jaccardSimilarity,
} from "./normalize";

export type DedupReason =
  | "exact_normalized" // A: normalized_name 동일
  | "alias_match" // B: alias ↔ name/name_en 교차
  | "ko_en_pair" // C: 같은 이벤트에 한글명+영문명 함께 등장
  | "token_overlap" // D: 토큰 자카드 ≥ 0.85
  | "name_contains"; // E: 한 이름이 다른 이름을 부분 포함 (예: "CHOI YU REE 최유리" ↔ "최유리")

export interface DedupMember {
  id: string;
  name: string;
  name_en: string | null;
  normalized_name: string | null;
  avatar_url: string | null;
  linked_event_count: number;
  followers_count: number;
  missing_fields: string[];
  created_at: string;
}

export interface DedupCandidate {
  /** 그룹 내 추천 keep ID (linked_event_count 최대) */
  suggestedKeepId: string;
  members: DedupMember[];
  reason: DedupReason;
  similarity: number; // 0~1
}

const MISSING_FIELDS = [
  "avatar_url",
  "occupation",
  "label",
  "country",
  "birth_date",
  "birth_place",
  "related",
] as const;

type ArtistBasic = {
  id: string;
  name: string;
  name_en: string | null;
  normalized_name: string | null;
  avatar_url: string | null;
  followers_count: number;
  upcoming_event_count: number;
  occupation: string | null;
  label: string | null;
  country: string | null;
  birth_date: string | null;
  birth_place: string | null;
  related: string | null;
  created_at: string;
};

function getMissingFields(a: ArtistBasic): string[] {
  return MISSING_FIELDS.filter((f) => !a[f as keyof ArtistBasic]);
}

function toMember(a: ArtistBasic, linkedCount: number): DedupMember {
  return {
    id: a.id,
    name: a.name,
    name_en: a.name_en,
    normalized_name: a.normalized_name,
    avatar_url: a.avatar_url,
    linked_event_count: linkedCount,
    followers_count: a.followers_count,
    missing_fields: getMissingFields(a),
    created_at: a.created_at,
  };
}

function buildCandidate(
  members: DedupMember[],
  reason: DedupReason,
  similarity: number,
): DedupCandidate {
  const sorted = [...members].sort(
    (a, b) =>
      b.linked_event_count - a.linked_event_count ||
      b.followers_count - a.followers_count,
  );
  return { suggestedKeepId: sorted[0].id, members: sorted, reason, similarity };
}

/** ID 중복 제거 후 그룹 병합 */
function mergeGroups(
  existing: Map<string, DedupCandidate>,
  newGroups: DedupCandidate[],
) {
  for (const g of newGroups) {
    const key = [...g.members.map((m) => m.id)].sort().join("|");
    if (!existing.has(key)) existing.set(key, g);
  }
}

export async function findDuplicateGroups(opts?: {
  limit?: number;
  minSimilarity?: number;
}): Promise<DedupCandidate[]> {
  const limit = Math.min(opts?.limit ?? 100, 500);
  const minSim = opts?.minSimilarity ?? 0.85;
  const db = createClient();

  // 전체 아티스트 fetch (배치 처리)
  const { data: rawArtists, error } = await db
    .from("artists")
    .select(
      "id,name,name_en,normalized_name,avatar_url,followers_count,upcoming_event_count," +
        "occupation,label,country,birth_date,birth_place,related,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(5000); // 최대 5000명 대상

  if (error || !rawArtists) return [];
  const allArtists = rawArtists as unknown as ArtistBasic[];

  // linked_event_count 일괄 조회
  const artistIds = allArtists.map((a) => a.id);
  const { data: eventLinks } = await db
    .from("event_artists")
    .select("artist_id")
    .in("artist_id", artistIds);

  const linkedCountMap: Record<string, number> = {};
  for (const { artist_id } of eventLinks ?? []) {
    linkedCountMap[artist_id] = (linkedCountMap[artist_id] ?? 0) + 1;
  }

  const memberOf = (a: ArtistBasic) => toMember(a, linkedCountMap[a.id] ?? 0);
  const groups = new Map<string, DedupCandidate>();

  // ── Stage A: normalized_name 완전 일치 ───────────────────────────
  const normGroups = new Map<string, ArtistBasic[]>();
  for (const a of allArtists as ArtistBasic[]) {
    const key = a.normalized_name
      ? normalizeKey(a.normalized_name)
      : normalizeKey(a.name);
    if (!key) continue;
    const g = normGroups.get(key) ?? [];
    g.push(a);
    normGroups.set(key, g);
  }
  const stageA: DedupCandidate[] = [];
  for (const group of Array.from(normGroups.values())) {
    if (group.length > 1) {
      stageA.push(buildCandidate(group.map(memberOf), "exact_normalized", 1.0));
    }
  }
  mergeGroups(groups, stageA);

  // ── Stage B: alias ↔ name/name_en 교차 ──────────────────────────
  const { data: allAliases } = await db
    .from("artist_aliases")
    .select("artist_id,alias")
    .in("artist_id", artistIds);

  if (allAliases && allAliases.length > 0) {
    // 이름(lower) → artistId 맵
    const nameToId = new Map<string, string>();
    for (const a of allArtists as ArtistBasic[]) {
      nameToId.set(a.name.toLowerCase(), a.id);
      if (a.name_en) nameToId.set(a.name_en.toLowerCase(), a.id);
      if (a.normalized_name)
        nameToId.set(a.normalized_name.toLowerCase(), a.id);
    }

    const artistById = new Map<string, ArtistBasic>(
      (allArtists as ArtistBasic[]).map((a) => [a.id, a]),
    );

    const pairsB = new Set<string>();
    for (const { artist_id, alias } of allAliases) {
      const matchId = nameToId.get(alias.toLowerCase());
      if (matchId && matchId !== artist_id) {
        const pairKey = [artist_id, matchId].sort().join("|");
        if (!pairsB.has(pairKey)) {
          pairsB.add(pairKey);
          const a = artistById.get(artist_id);
          const b = artistById.get(matchId);
          if (a && b) {
            groups.set(
              pairKey,
              buildCandidate([memberOf(a), memberOf(b)], "alias_match", 0.95),
            );
          }
        }
      }
    }
  }

  // ── Stage C: 같은 이벤트에 한글명 + 영문명 아티스트 동시 등장 ────
  const { data: eventArtistPairs } = await db
    .from("event_artists")
    .select("event_id,artist_id")
    .in("artist_id", artistIds);

  if (eventArtistPairs && eventArtistPairs.length > 0) {
    // event_id → artist_id[] 맵
    const eventMap = new Map<string, string[]>();
    for (const { event_id, artist_id } of eventArtistPairs) {
      const arr = eventMap.get(event_id) ?? [];
      arr.push(artist_id);
      eventMap.set(event_id, arr);
    }

    const artistById = new Map<string, ArtistBasic>(
      (allArtists as ArtistBasic[]).map((a) => [a.id, a]),
    );

    const pairsC = new Set<string>();
    for (const [, ids] of Array.from(eventMap)) {
      const artists = ids
        .map((id: string) => artistById.get(id))
        .filter(Boolean) as ArtistBasic[];
      const koreans = artists.filter((a) => isKoreanOnly(a.name));
      // isNonKorean: 영문 전용("IU") 뿐 아니라 숫자+영문("10CM","2NE1")도 포함
      const latins = artists.filter((a) => isNonKorean(a.name));

      for (const ko of koreans) {
        for (const en of latins) {
          // 한/영 쌍 후보 (예: "아이유"↔"IU", "십센치"↔"10CM", "방탄소년단"↔"BTS")
          const pairKey = [ko.id, en.id].sort().join("|");
          if (!pairsC.has(pairKey) && !groups.has(pairKey)) {
            pairsC.add(pairKey);
            groups.set(
              pairKey,
              buildCandidate([memberOf(ko), memberOf(en)], "ko_en_pair", 0.7),
            );
          }
        }
      }
    }
  }

  // ── Stage D: 동일 언어 그룹 내 토큰 자카드 유사도 ≥ minSim ───────
  const artistsForD = allArtists as ArtistBasic[];
  // 성능 상 한글끼리, 영문끼리만 비교
  const koArtists = artistsForD.filter((a) => isKoreanOnly(a.name));
  const enArtists = artistsForD.filter((a) => isLatinOnly(a.name));

  const checkGroup = (group: ArtistBasic[]) => {
    for (let i = 0; i < group.length - 1; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const pairKey = [a.id, b.id].sort().join("|");
        if (groups.has(pairKey)) continue;

        const tokA = tokenize(a.name);
        const tokB = tokenize(b.name);
        const sim = jaccardSimilarity(tokA, tokB);
        if (sim >= minSim) {
          groups.set(
            pairKey,
            buildCandidate([memberOf(a), memberOf(b)], "token_overlap", sim),
          );
        }
      }
    }
  };

  // 이름 길이 차이가 1 이내인 것만 비교 (성능 최적화)
  const groupByLength = (arr: ArtistBasic[]) => {
    const byLen = new Map<number, ArtistBasic[]>();
    for (const a of arr) {
      const l = a.name.length;
      for (const d of [-1, 0, 1]) {
        const g = byLen.get(l + d) ?? [];
        if (!g.includes(a)) g.push(a);
        byLen.set(l + d, g);
      }
    }
    return byLen;
  };

  for (const [, group] of Array.from(groupByLength(koArtists)))
    checkGroup(group);
  for (const [, group] of Array.from(groupByLength(enArtists)))
    checkGroup(group);

  // ── Stage E: 부분 문자열 포함 탐지 ─────────────────────────────────
  // "CHOI YU REE 최유리" ↔ "최유리" 같은 케이스: 짧은 이름이 긴 이름 안에 포함
  // 최소 길이 2자 이상, 포함 비율 ≥ 0.4 (짧은 이름 / 긴 이름)
  const allForE = allArtists as ArtistBasic[];
  for (let i = 0; i < allForE.length - 1; i++) {
    for (let j = i + 1; j < allForE.length; j++) {
      const a = allForE[i];
      const b = allForE[j];
      const pairKey = [a.id, b.id].sort().join("|");
      if (groups.has(pairKey)) continue;

      const keyA = normalizeKey(a.name);
      const keyB = normalizeKey(b.name);
      if (keyA.length < 2 || keyB.length < 2) continue;

      const [shorter, longer] =
        keyA.length <= keyB.length ? [keyA, keyB] : [keyB, keyA];

      // 짧은 키가 긴 키 안에 포함되고, 길이 비율이 0.4 이상
      if (longer.includes(shorter) && shorter.length / longer.length >= 0.4) {
        const sim = shorter.length / longer.length;
        const [shortArtist, longArtist] =
          keyA.length <= keyB.length ? [a, b] : [b, a];
        groups.set(
          pairKey,
          buildCandidate(
            [memberOf(longArtist), memberOf(shortArtist)],
            "name_contains",
            sim,
          ),
        );
      }
    }
  }

  // ── 결과 조합 및 limit 적용 ──────────────────────────────────────
  const result = Array.from(groups.values())
    .filter((g) => g.similarity >= minSim || g.reason !== "token_overlap")
    .sort((a, b) => {
      // 신뢰도 높은 순, 그 다음 members의 linked_event_count 합산 순
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      const sumLinked = (c: DedupCandidate) =>
        c.members.reduce((s, m) => s + m.linked_event_count, 0);
      return sumLinked(b) - sumLinked(a);
    })
    .slice(0, limit);

  return result;
}
