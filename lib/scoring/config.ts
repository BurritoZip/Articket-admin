import type { ScoringConfig } from "@/types/scoring";

/**
 * 스코어링 가중치 — 단일 튜닝 지점.
 * 엔진은 enabled 신호만 합산 후 합=1로 재정규화하므로,
 * 외부 신호(Spotify/YouTube) 예약 슬롯은 enabled:false로 두고 나중에 켜기만 하면 됨.
 * (타 가중치 수동 조정 불필요. 플랫폼 성장 후 행동신호 비중↑도 여기서.)
 */
export const SCORING_WEIGHTS: ScoringConfig = {
  artist: [
    { key: "followers_count", weight: 0.2, label: "팔로워 수", enabled: true },
    { key: "follower_graph_count", weight: 0.25, label: "앱 내 팔로우 수", enabled: true },
    { key: "upcoming_event_count", weight: 0.1, label: "예정 공연 수", enabled: true },
    { key: "event_bookmark_total", weight: 0.2, label: "공연 북마크 합", enabled: true },
    { key: "review_volume", weight: 0.1, label: "리뷰 수", enabled: true },
    { key: "review_avg", weight: 0.15, label: "평균 평점", enabled: true },
    // 예약 슬롯 (Phase 2에서 enabled:true) — 비활성 시 가중치 재분배에서 제외
    { key: "spotify_popularity", weight: 0, label: "Spotify 인기도", enabled: false },
    { key: "youtube_subscribers", weight: 0, label: "YouTube 구독자", enabled: false },
  ],
  concert: [
    { key: "artist_influence", weight: 0.4, label: "참여 아티스트 영향력", enabled: true },
    { key: "ticket_demand", weight: 0.25, label: "티켓 수요 지표", enabled: true },
    { key: "event_scale", weight: 0.15, label: "공연 규모", enabled: true },
    { key: "community_attention", weight: 0.1, label: "커뮤니티 관심", enabled: true },
    { key: "freshness", weight: 0.1, label: "공연 임박도", enabled: true },
  ],
  trending: {
    currentWindowDays: 7,
    baselineWindowDays: 30,
    minSnapshotsForTrend: 2,
  },
  normalization: {
    minPopulationForPercentile: 20,
  },
};

/** 정규화 없이 이미 0~100인 콘서트 신호 (avg of artist scores, 임박도) */
export const CONCERT_PRENORMALIZED = new Set(["artist_influence", "freshness"]);
