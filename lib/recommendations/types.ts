export const HOMEPAGE_WEIGHTS = {
  popularity: 0.45,
  trending: 0.25,
  recommendation: 0.2,
  freshness: 0.1,
} as const;

// LocationMatch는 user geo 부재로 제외, 0.15를 나머지 비율 유지 재분배
export const RECOMMENDATION_WEIGHTS = {
  favoriteArtist: 0.47,
  similarArtist: 0.29,
  behavior: 0.24,
  location: 0,
} as const;

export interface RecommendationBreakdown {
  favoriteArtistMatch: number;
  similarArtistMatch: number;
  behaviorMatch: number;
  locationMatch: number;
  locationDeferred: true;
}

export interface ScoredEvent {
  eventId: string;
  title: string;
  posterUrl: string | null;
  startDate: string;
  status: string;
  finalScore: number;
  breakdown: {
    popularity: number;
    trending: number;
    recommendation: number;
    freshness: number;
  };
  recommendation: RecommendationBreakdown;
  reasons: string[];
}

export interface RecommendationsResponse {
  userId: string;
  generatedAt: string;
  weights: typeof HOMEPAGE_WEIGHTS;
  recommendationWeights: typeof RECOMMENDATION_WEIGHTS;
  items: ScoredEvent[];
  page: { limit: number; offset: number; hasMore: boolean };
}
