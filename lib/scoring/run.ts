import { computeArtistPopularityScores, type ArtistScoreResult } from "./artist-score";
import { computeConcertPopularityScores, type ConcertScoreResult } from "./concert-score";
import { captureSnapshots, type SnapshotResult } from "./snapshot";
import { computeTrendingScores, type TrendingResult } from "./trending";

export interface RunScoringResult {
  artist_scored: number;
  concert_scored: number;
  snapshot_rows: number;
  trending_updated: number;
  trending_cold_start: number;
  low_confidence: number;
}

/**
 * 스코어링 파이프라인 스텝.
 * artist → concert(artist 의존) → snapshot(갓 계산한 점수) → trending(스냅샷 히스토리) 순.
 */
export async function runScoring(): Promise<RunScoringResult> {
  const artist: ArtistScoreResult = await computeArtistPopularityScores();
  const concert: ConcertScoreResult = await computeConcertPopularityScores();
  const snapshot: SnapshotResult = await captureSnapshots();
  const trending: TrendingResult = await computeTrendingScores();

  return {
    artist_scored: artist.scored,
    concert_scored: concert.scored,
    snapshot_rows: snapshot.artistRows + snapshot.eventRows,
    trending_updated: trending.artistsUpdated + trending.eventsUpdated,
    trending_cold_start: trending.coldStart,
    low_confidence: artist.lowConfidence + concert.lowConfidence,
  };
}
