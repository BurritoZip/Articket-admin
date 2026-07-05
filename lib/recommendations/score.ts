import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, round2 } from "@/lib/scoring/util";
import {
  HOMEPAGE_WEIGHTS,
  RECOMMENDATION_WEIGHTS,
  type RecommendationsResponse,
  type ScoredEvent,
} from "./types";

interface CandidateRow {
  id: string;
  title: string;
  poster_url: string | null;
  start_date: string;
  status: string;
  genre: string | null;
  popularity_score: number | null;
  trending_score: number | null;
}
interface EventArtistRow {
  event_id: string;
  artist_id: string;
  artist_name: string;
  display_order: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** 시작일 기준 임박도 0~1 */
function freshnessNorm(startDate: string): number {
  const days = (new Date(startDate).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return 0.7;
  if (days <= 14) return 1;
  if (days <= 30) return 0.8;
  if (days <= 60) return 0.65;
  if (days <= 90) return 0.5; // 3개월 이내 최소 0.5 보장
  if (days <= 180) return 0.35;
  return 0.2;
}

/** trending(비율 ×100, 100=보합) → 0~1 */
function trendingNorm(trending: number | null): number {
  return clamp01((trending ?? 0) / 200);
}

/** related TEXT(쉼표/구분자) → 정규화 이름 집합 */
function parseRelated(text: string | null): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .split(/[,·、\/|]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function computeRecommendations(
  userId: string,
  opts: { limit: number; offset: number; db: SupabaseClient },
): Promise<RecommendationsResponse> {
  const { db, limit, offset } = opts;

  // 1) 유저 시그널 (JWT 검증 완료 → service-role로 본인 행 조회)
  const [followRows, interestRows, bookingRows] = await Promise.all([
    db.from("user_artist_followings").select("artist_id").eq("user_id", userId),
    db.from("user_interested_events").select("event_id").eq("user_id", userId),
    db.from("user_bookings").select("event_id").eq("user_id", userId),
  ]);
  const followedArtistIds = new Set<string>(
    (followRows.data ?? []).map((r) => r.artist_id),
  );
  const behaviorEventIds = new Set<string>([
    ...(interestRows.data ?? []).map((r) => r.event_id),
    ...(bookingRows.data ?? []).map((r) => r.event_id),
  ]);

  // 2) 후보 공연 + 전체 event_artists
  const [candidates, eventArtists] = await Promise.all([
    fetchAll<CandidateRow>((f, t) =>
      db
        .from("events")
        .select(
          "id,title,poster_url,start_date,status,genre,popularity_score,trending_score",
        )
        .in("status", ["on_sale", "upcoming"])
        .gte("end_date", new Date().toISOString().split("T")[0])
        .range(f, t),
    ),
    fetchAll<EventArtistRow>((f, t) =>
      db
        .from("event_artists")
        .select("event_id,artist_id,artist_name,display_order")
        .range(f, t),
    ),
  ]);

  // event_id → 참여 아티스트
  const artistsByEvent = new Map<string, EventArtistRow[]>();
  for (const ea of eventArtists) {
    const arr = artistsByEvent.get(ea.event_id) ?? [];
    arr.push(ea);
    artistsByEvent.set(ea.event_id, arr);
  }

  // 3) 행동 프로필 — 관심/예매 공연의 장르 + 아티스트, 팔로우 아티스트 related 이름
  const behaviorGenres = new Set<string>();
  const behaviorArtistIds = new Set<string>();
  if (behaviorEventIds.size > 0) {
    const ids = Array.from(behaviorEventIds);
    const { data: bEvents } = await db
      .from("events")
      .select("id,genre")
      .in("id", ids);
    for (const e of bEvents ?? []) if (e.genre) behaviorGenres.add(e.genre);
    for (const id of ids) {
      for (const ea of artistsByEvent.get(id) ?? [])
        behaviorArtistIds.add(ea.artist_id);
    }
  }
  const relatedNames = new Set<string>();
  if (followedArtistIds.size > 0) {
    const { data: fArtists } = await db
      .from("artists")
      .select("related")
      .in("id", Array.from(followedArtistIds));
    for (const a of fArtists ?? [])
      for (const n of Array.from(parseRelated(a.related))) relatedNames.add(n);
  }

  // 4) 후보별 점수
  const scored: ScoredEvent[] = candidates.map((ev) => {
    const arts = artistsByEvent.get(ev.id) ?? [];
    const minOrder = arts.length
      ? Math.min(...arts.map((a) => a.display_order))
      : 0;

    // FavoriteArtistMatch
    const matched = arts.filter((a) => followedArtistIds.has(a.artist_id));
    let fav = 0;
    if (matched.length) {
      const headliner = matched.some((a) => a.display_order === minOrder);
      fav = clamp01(
        (headliner ? 0.7 : 0.5) +
          (0.3 * matched.length) / Math.max(1, arts.length),
      );
    }

    // SimilarArtistMatch — 장르 겹침 + related 이름 매칭
    const genreHit = ev.genre != null && behaviorGenres.has(ev.genre);
    const relatedHit = arts.some((a) =>
      relatedNames.has(a.artist_name.trim().toLowerCase()),
    );
    const similar = clamp01((genreHit ? 0.6 : 0) + (relatedHit ? 0.4 : 0));

    // BehaviorMatch — 장르 + 아티스트 겹침
    const behaviorArtistHit = arts.some((a) =>
      behaviorArtistIds.has(a.artist_id),
    );
    const behavior = clamp01(
      (genreHit ? 0.5 : 0) + (behaviorArtistHit ? 0.5 : 0),
    );

    const recommendation = clamp01(
      RECOMMENDATION_WEIGHTS.favoriteArtist * fav +
        RECOMMENDATION_WEIGHTS.similarArtist * similar +
        RECOMMENDATION_WEIGHTS.behavior * behavior,
    );

    const popularity = clamp01((ev.popularity_score ?? 0) / 100);
    const trending = trendingNorm(ev.trending_score);
    const freshness = freshnessNorm(ev.start_date);

    const finalScore =
      HOMEPAGE_WEIGHTS.popularity * popularity +
      HOMEPAGE_WEIGHTS.trending * trending +
      HOMEPAGE_WEIGHTS.recommendation * recommendation +
      HOMEPAGE_WEIGHTS.freshness * freshness;

    const reasons: string[] = [];
    if (matched.length)
      reasons.push(`회원님이 팔로우한 아티스트 ${matched.length}명이 출연해요`);
    if ((ev.trending_score ?? 0) > 110)
      reasons.push(
        `이번 주 인기 급상승 +${Math.round((ev.trending_score ?? 0) - 100)}%`,
      );
    if (!matched.length && (genreHit || behaviorArtistHit))
      reasons.push("회원님이 관심 등록한 공연과 비슷해요");
    if (reasons.length === 0 && popularity >= 0.5)
      reasons.push("지금 인기 있는 공연");

    return {
      eventId: ev.id,
      title: ev.title,
      posterUrl: ev.poster_url,
      startDate: ev.start_date,
      status: ev.status,
      finalScore: Number(finalScore.toFixed(4)),
      breakdown: {
        popularity: round2(popularity),
        trending: round2(trending),
        recommendation: round2(recommendation),
        freshness: round2(freshness),
      },
      recommendation: {
        favoriteArtistMatch: round2(fav),
        similarArtistMatch: round2(similar),
        behaviorMatch: round2(behavior),
        locationMatch: 0,
        locationDeferred: true,
      },
      reasons,
    };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);
  const page = scored.slice(offset, offset + limit);

  return {
    userId,
    generatedAt: new Date().toISOString(),
    weights: HOMEPAGE_WEIGHTS,
    recommendationWeights: RECOMMENDATION_WEIGHTS,
    items: page,
    page: { limit, offset, hasMore: offset + limit < scored.length },
  };
}
