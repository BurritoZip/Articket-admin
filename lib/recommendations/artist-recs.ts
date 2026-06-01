import type { SupabaseClient } from "@supabase/supabase-js";
import { round2 } from "@/lib/scoring/util";

// ============================================================
// 아티스트 추천 — "인기 아티스트" + "당신이 좋아할만한 아티스트"
// ============================================================
// 인기 아티스트  = artists.popularity_score (팔로우/공연 좋아요 기반 배치 점수) 내림차순
// 좋아할만한     = 팔로우 아티스트 기준 (1)같은 무대 출연 (2)같은 소속사 (3)비슷한 장르
//   popularity_score는 가중치가 아니라 동점 시 정렬 보조 + 콜드스타트 폴백으로만 사용.

export const ARTIST_REC_WEIGHTS = {
  coPerformer: 0.4, // 팔로우 아티스트와 같은 공연/페스티벌 라인업
  agency: 0.3, // 같은 소속사(label)
  genre: 0.3, // 비슷한 장르 (events/timetable 장르 프로필 겹침)
} as const;

export interface PopularArtist {
  artistId: string;
  name: string;
  avatarUrl: string | null;
  label: string | null;
  followersCount: number | null;
  upcomingEventCount: number | null;
  popularityScore: number | null;
  trendingScore: number | null;
  rank: number;
}

export interface RecommendedArtist {
  artistId: string;
  name: string;
  avatarUrl: string | null;
  label: string | null;
  followersCount: number | null;
  upcomingEventCount: number | null;
  popularityScore: number | null;
  score: number; // 0~1 추천 점수
  breakdown: { coPerformer: number; agency: number; genre: number };
  reasons: string[];
}

export interface ArtistRecommendationsResponse {
  userId: string | null;
  generatedAt: string;
  weights: typeof ARTIST_REC_WEIGHTS;
  popular: PopularArtist[];
  forYou: RecommendedArtist[];
  forYouColdStart: boolean; // 팔로우 없음 → forYou를 인기 기반으로 채움
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const MAX_CANDIDATES = 400; // 메타 조회/점수 계산 상한
const ID_CHUNK = 150; // .in() URL 길이 보호용 청크

interface ArtistMeta {
  id: string;
  name: string;
  avatar_url: string | null;
  label: string | null;
  popularity_score: number | null;
  followers_count: number | null;
  upcoming_event_count: number | null;
}

/** id 목록을 청크로 나눠 artists 메타를 조회 */
async function fetchArtistMeta(
  db: SupabaseClient,
  ids: string[],
): Promise<Map<string, ArtistMeta>> {
  const out = new Map<string, ArtistMeta>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data } = await db
      .from("artists")
      .select(
        "id,name,avatar_url,label,popularity_score,followers_count,upcoming_event_count",
      )
      .in("id", chunk);
    for (const a of (data ?? []) as ArtistMeta[]) out.set(a.id, a);
  }
  return out;
}

/** 인기 아티스트 — popularity_score 우선, 없으면 followers_count 폴백 */
export async function computePopularArtists(
  db: SupabaseClient,
  limit: number,
): Promise<PopularArtist[]> {
  const { data } = await db
    .from("artists")
    .select(
      "id,name,avatar_url,label,followers_count,upcoming_event_count,popularity_score,trending_score",
    )
    .order("popularity_score", { ascending: false, nullsFirst: false })
    .order("followers_count", { ascending: false, nullsFirst: false })
    .limit(limit);

  return (data ?? []).map((a, i) => ({
    artistId: a.id,
    name: a.name,
    avatarUrl: a.avatar_url,
    label: a.label,
    followersCount: a.followers_count,
    upcomingEventCount: a.upcoming_event_count,
    popularityScore: a.popularity_score,
    trendingScore: a.trending_score,
    rank: i + 1,
  }));
}

/**
 * 좋아할만한 아티스트 — 팔로우 아티스트 기반 개인화.
 * 팔로우가 없으면 forYou 빈 배열 + coldStart=true (라우트에서 인기로 폴백).
 */
export async function computeArtistRecommendations(
  db: SupabaseClient,
  userId: string,
  limit: number,
): Promise<{ items: RecommendedArtist[]; coldStart: boolean }> {
  // 1) 팔로우 아티스트
  const { data: follows } = await db
    .from("user_artist_followings")
    .select("artist_id")
    .eq("user_id", userId);
  const followedIds = new Set<string>((follows ?? []).map((r) => r.artist_id));
  if (followedIds.size === 0) return { items: [], coldStart: true };
  const followedArr = Array.from(followedIds);

  // 팔로우 아티스트 메타 (소속사 + 이름)
  const followedMeta = await fetchArtistMeta(db, followedArr);
  const followedLabels = new Set<string>();
  for (const m of Array.from(followedMeta.values())) {
    const l = (m.label ?? "").trim();
    if (l) followedLabels.add(l);
  }

  // 후보별 누적 신호
  const coShared = new Map<string, Set<string>>(); // candidate → 공유 event_id 집합
  const coSampleFollowed = new Map<string, string>(); // candidate → 함께 선 팔로우 이름
  const agencyLabel = new Map<string, string>(); // candidate → 같은 소속사 label
  const genreMatched = new Map<string, Set<string>>(); // candidate → 겹친 장르 집합

  // 2) 같은 무대 — 팔로우가 출연한 공연 → 그 공연의 다른 출연자
  const { data: followedEAs } = await db
    .from("event_artists")
    .select("event_id,artist_id,artist_name")
    .in("artist_id", followedArr);
  const eventToFollowedName = new Map<string, string>();
  const followedEventIds = new Set<string>();
  for (const r of followedEAs ?? []) {
    followedEventIds.add(r.event_id);
    if (!eventToFollowedName.has(r.event_id))
      eventToFollowedName.set(r.event_id, r.artist_name);
  }
  if (followedEventIds.size > 0) {
    const evArr = Array.from(followedEventIds);
    for (let i = 0; i < evArr.length; i += ID_CHUNK) {
      const chunk = evArr.slice(i, i + ID_CHUNK);
      const { data: lineup } = await db
        .from("event_artists")
        .select("event_id,artist_id")
        .in("event_id", chunk);
      for (const r of lineup ?? []) {
        if (!r.artist_id || followedIds.has(r.artist_id)) continue;
        const set = coShared.get(r.artist_id) ?? new Set<string>();
        set.add(r.event_id);
        coShared.set(r.artist_id, set);
        if (!coSampleFollowed.has(r.artist_id)) {
          const nm = eventToFollowedName.get(r.event_id);
          if (nm) coSampleFollowed.set(r.artist_id, nm);
        }
      }
    }
  }

  // 3) 같은 소속사
  if (followedLabels.size > 0) {
    const { data: sameLabel } = await db
      .from("artists")
      .select("id,label")
      .in("label", Array.from(followedLabels));
    for (const a of sameLabel ?? []) {
      if (followedIds.has(a.id)) continue;
      if (a.label) agencyLabel.set(a.id, a.label);
    }
  }

  // 4) 비슷한 장르 — 팔로우 장르 프로필 → 같은 장르 아티스트
  const { data: followedGenreRows } = await db
    .from("artist_genre_agg")
    .select("genre")
    .in("artist_id", followedArr);
  const followedGenres = new Set<string>(
    (followedGenreRows ?? []).map((r) => r.genre).filter(Boolean),
  );
  if (followedGenres.size > 0) {
    const { data: genreRows } = await db
      .from("artist_genre_agg")
      .select("artist_id,genre")
      .in("genre", Array.from(followedGenres));
    for (const r of genreRows ?? []) {
      if (!r.artist_id || followedIds.has(r.artist_id)) continue;
      const set = genreMatched.get(r.artist_id) ?? new Set<string>();
      set.add(r.genre);
      genreMatched.set(r.artist_id, set);
    }
  }

  // 5) 후보 합집합 — 너무 많으면 강한 신호(공연/소속사) 우선, 장르는 매칭 많은 순
  const candidateIds = new Set<string>([
    ...Array.from(coShared.keys()),
    ...Array.from(agencyLabel.keys()),
    ...Array.from(genreMatched.keys()),
  ]);
  let ids = Array.from(candidateIds);
  if (ids.length > MAX_CANDIDATES) {
    ids.sort((a, b) => {
      const strongA = (coShared.has(a) ? 1 : 0) + (agencyLabel.has(a) ? 1 : 0);
      const strongB = (coShared.has(b) ? 1 : 0) + (agencyLabel.has(b) ? 1 : 0);
      if (strongA !== strongB) return strongB - strongA;
      return (
        (genreMatched.get(b)?.size ?? 0) - (genreMatched.get(a)?.size ?? 0)
      );
    });
    ids = ids.slice(0, MAX_CANDIDATES);
  }

  // 6) 후보 메타 조회 + 점수 산출
  const meta = await fetchArtistMeta(db, ids);
  const genreDenom = Math.max(1, followedGenres.size);

  const items: RecommendedArtist[] = [];
  for (const id of ids) {
    const m = meta.get(id);
    if (!m) continue;

    const shared = coShared.get(id)?.size ?? 0;
    const co = shared > 0 ? clamp01(0.5 + (0.5 * (shared - 1)) / 3) : 0;
    const ag = agencyLabel.has(id) ? 1 : 0;
    const ge = clamp01((genreMatched.get(id)?.size ?? 0) / genreDenom);

    const score = clamp01(
      ARTIST_REC_WEIGHTS.coPerformer * co +
        ARTIST_REC_WEIGHTS.agency * ag +
        ARTIST_REC_WEIGHTS.genre * ge,
    );
    if (score <= 0) continue;

    const reasons: string[] = [];
    if (shared > 0) {
      const nm = coSampleFollowed.get(id);
      reasons.push(
        nm
          ? `회원님이 팔로우한 ${nm}와 같은 무대에 섰어요`
          : "회원님이 팔로우한 아티스트와 같은 무대에 섰어요",
      );
    }
    if (ag) reasons.push(`같은 소속사 (${agencyLabel.get(id)}) 아티스트예요`);
    if (ge >= 0.5 || (genreMatched.get(id)?.size ?? 0) >= 1) {
      const g = Array.from(genreMatched.get(id) ?? [])[0];
      if (g) reasons.push(`비슷한 장르(${g})를 해요`);
    }

    items.push({
      artistId: id,
      name: m.name,
      avatarUrl: m.avatar_url,
      label: m.label,
      followersCount: m.followers_count,
      upcomingEventCount: m.upcoming_event_count,
      popularityScore: m.popularity_score,
      score: Number(score.toFixed(4)),
      breakdown: {
        coPerformer: round2(co),
        agency: round2(ag),
        genre: round2(ge),
      },
      reasons,
    });
  }

  // 점수 내림차순, 동점이면 popularity_score 보조 정렬
  items.sort(
    (a, b) =>
      b.score - a.score || (b.popularityScore ?? 0) - (a.popularityScore ?? 0),
  );

  return { items: items.slice(0, limit), coldStart: false };
}
