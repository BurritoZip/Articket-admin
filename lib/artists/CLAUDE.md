# lib/artists/ — 아티스트 중복탐지·병합·보강

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `dedup.ts` | 중복 후보 탐지 — `findDuplicateGroups(opts?)`, 4단계 (exact/alias/token/contains) |
| `merge.ts` | 두 아티스트 병합 — `mergeArtists({keepId, mergeId})`, FK 재지정 + 필드 병합 + 로그 |
| `auto-merge.ts` | exact_normalized(similarity=1.0)만 자동 병합 — `autoMergeExactArtists()` |
| `normalize.ts` | 이름 정규화 유틸 — `normalizeKey()`, `tokenize()`, `jaccardSimilarity()` |
| `enrich/index.ts` | 아티스트 정보 보강 — `enrichArtist(artistId)`, `processArtistEnrichmentQueue(n)` |
| `enrich/namu.ts` | 나무위키 보강 소스 |
| `enrich/melon.ts` | 멜론 보강 소스 |
| `enrich/naver.ts` | 네이버 보강 소스 |

## 보강 우선순위

Namu > Melon > Naver > Wikipedia (각 소스 필드별 채움, 기존값 덮어쓰지 않음)

## 병합 안전 기준

자동 병합: similarity=1.0 (exact_normalized)만 허용
수동 병합: UI에서 확인 후 `POST /api/admin/artists/merge`
</content>
</invoke>