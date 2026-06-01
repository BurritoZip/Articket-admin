# lib/venues/ — 공연장 병합

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `merge.ts` | 공연장 병합 — `mergeVenues(keepId, mergeId)`, FK 재지정 + 필드 보완 + 삭제 |
| `auto-merge.ts` | normalized_name 완전일치 자동 병합 — `autoMergeExactVenues()` |

## 참고

공연장 중복 탐지: `app/api/admin/venues/dedup/route.ts`
수동 병합 UI: `components/admin/VenueDedupSheet.tsx`
