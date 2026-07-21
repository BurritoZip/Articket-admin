/**
 * 소스 신뢰도 — upsert 병합 우선순위.
 *
 * crawler_sources.trust_score 가 SoT 이지만, upsert 는 이벤트마다 호출되므로 매번 DB 조회하면
 * 부담이다. 그 값을 여기 상수로 미러링한다(마이그레이션 20260721020000 과 동일하게 유지).
 * 소스가 바뀌면 두 곳 다 갱신.
 *
 *   운영자 수동 수정(locked_fields)은 이 표 밖에서 최우선으로 보호된다.
 *   enrich(Gemini)가 채운 값의 provenance 통합은 후속 과제 — 현재는 크롤 소스 간 병합만 다룬다.
 */
export const SOURCE_TRUST: Record<string, number> = {
  // enrich = Gemini 그라운딩/결정론적 보강. 크롤이 "콘서트" 같은 부정확한 기본값으로 덮지
  // 못하게 예매처(70)보다 높게 둔다. enrich 는 이미 채워진 값을 안 건드리므로(게이트),
  // 이 값이 최종 확정에 가깝다.
  enrich: 90,
  interpark: 70,
  yes24: 70,
  melon: 70,
  yanolja: 70,
  stagepick: 60,
  festivallife: 55,
  "gemini-search": 20,
};

/** enrich 경로가 채운 필드의 provenance 출처명 */
export const ENRICH_SOURCE = "enrich";

/** 알 수 없는 소스는 중간값(50) — 마이그레이션 DEFAULT 와 동일 */
const DEFAULT_TRUST = 50;

export function trustOf(source: string | null | undefined): number {
  if (!source) return 0; // 출처 미상(예: 과거 데이터)은 최하 — 어떤 소스든 덮을 수 있게
  return SOURCE_TRUST[source] ?? DEFAULT_TRUST;
}
