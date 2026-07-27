import { eventDedupKey } from "./match-key";

/** @deprecated 강한 키 위임. rawTitle 을 넘기면 marker-aware 로 계산된다. */
export function generateDedupKey(
  titleOrRaw: string,
  normalizedVenueName: string | null,
  startDate: string | null,
): string {
  return eventDedupKey(titleOrRaw, normalizedVenueName, startDate);
}

export function isDuplicate(keyA: string, keyB: string): boolean {
  return keyA === keyB;
}
