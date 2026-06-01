/** 신호 키 → 원시 값 */
export type ArtistSignals = Record<string, number>;

export interface ArtistSignalProvider {
  name: string;
  /** 주어진 아티스트 id들의 원시 신호를 배치 수집. 누락 키는 0 취급. */
  fetch(artistIds: string[]): Promise<Map<string, ArtistSignals>>;
}
