# lib/venues/ — 공연장 병합

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `merge.ts` | 공연장 병합 — `mergeVenues(keepId, mergeId)`, FK 재지정 + 필드 보완 + 삭제 |
| `auto-merge.ts` | normalized_name 완전일치 + 주소-인지(주소 다르면 보류) 자동 병합 — `autoMergeExactVenues()` |
| `dedup-detect.ts` | 중복 후보 탐지 순수 로직 — `detectDuplicateCandidates()`. Stage A(정규화 완전일치)/B(이름 포함)/C(토큰 자카드). route와 일회성 스크립트가 공유(AI 검증 이전) |
| `enrich.ts` | 주소 없는 공연장 Gemini 보강(`processVenueAddressEnrichment`) — 파이프라인 상시 |

## 참고

공연장 중복 탐지 API(Gemini 검증): `app/api/admin/venues/dedup/route.ts` — `dedup-detect.ts` 사용
수동 병합 UI: `components/admin/VenueDedupSheet.tsx`
일회성 정리(Gemini 다운 대응, Claude+웹검색): `scripts/pipeline/venue-cleanup-claude.ts` — 주소 오염 수정 + 이름변형 중복 병합, dry-run 기본 `--apply` 실행
