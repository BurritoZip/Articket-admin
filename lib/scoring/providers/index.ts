import { dbArtistSignalProvider } from "./db-provider";
import type { ArtistSignalProvider, ArtistSignals } from "./types";

/**
 * 신호 provider 레지스트리.
 * Phase 2에서 Spotify/YouTube provider를 여기에 append하면
 * 점수 엔진은 변경 없이 새 신호를 흡수한다.
 */
export const ARTIST_SIGNAL_PROVIDERS: ArtistSignalProvider[] = [
  dbArtistSignalProvider,
];

/** 모든 provider 신호를 병합 — 같은 키는 나중 provider가 덮어씀 */
export async function collectArtistSignals(
  artistIds: string[],
): Promise<Map<string, ArtistSignals>> {
  const merged = new Map<string, ArtistSignals>();
  for (const provider of ARTIST_SIGNAL_PROVIDERS) {
    const part = await provider.fetch(artistIds);
    for (const [id, signals] of Array.from(part)) {
      merged.set(id, { ...(merged.get(id) ?? {}), ...signals });
    }
  }
  return merged;
}

export type { ArtistSignalProvider, ArtistSignals } from "./types";
