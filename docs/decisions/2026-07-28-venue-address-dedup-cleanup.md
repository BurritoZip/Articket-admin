# 공연장 주소 오염·이름 중복 정리 설계

**날짜**: 2026-07-28
**상태**: 승인 대기

## 문제

1. **주소=이름 오염**: 다수 공연장의 `address`가 실제 주소가 아니라 공연장 이름으로 저장돼 있다.
2. **이름 변형 중복**: 같은 물리적 공연장이 이름 변형으로 여러 행 존재. 단, 같은 이름이어도 주소가 명확히 다르면 실제 별개 공간(유지 대상)인 경우가 있다.

## 근본 원인 (코드 확인됨)

- **Prob 1** — `lib/ingestion/artist-matcher.ts:351`: 스크래퍼가 "장소" 필드에 이름을 넣으면 `address: venueAddress ?? ""`로 그대로 저장돼 `address == name`이 된다. `lib/venues/enrich.ts:27`은 `address.is.null OR address.eq.`(빈값)일 때만 보강하므로, **비어있지 않은 오염 행(이름=주소)은 재보강 대상에서 영원히 제외된다.**
- **Prob 2** — `lib/venues/auto-merge.ts`: `normalized_name` 완전일치 그룹을 **주소를 전혀 보지 않고** 무조건 병합한다. 대형 공연장의 이름 변형("KSPO DOME" ↔ "올림픽체조경기장")은 완전일치가 아니라 병합되지 않고 중복으로 남는다.

## 범위 결정 (합의됨)

- 기존 오염 DB 정리 **+** 재발 방지 파이프라인 수정 둘 다.
- 일회성 정리는 **Claude(Anthropic API)** 로 처리. 파이프라인 상시 보강은 **Gemini 유지**(Gemini 복구 시 정상 동작). Claude 클라이언트는 정리 스크립트 안에만 둔다.
- 병합 판단에 주소 반영: 주소가 다르면 병합 보류, 같거나 비면 병합.
- 이름 변형까지의 병합은 일회성 Claude 정리에서 수행.
- Phase 2 병합: dry-run으로 판정·병합후보 확인 후 `--apply`로 자동 병합(`mergeVenues` 실행).
- Claude 주소 조회에 `web_search` 툴(실시간 그라운딩) 사용.

## 아키텍처

### ① 파이프라인 수정 — `lib/venues/auto-merge.ts` 주소-인지 (LLM 없음)

같은 `normalized_name` 그룹 안에서 keep 선정(event_count 최다)은 그대로. 병합 조건만 변경:

- 멤버를 keep에 병합하는 조건: `멤버 주소가 비었음` **OR** `keep 주소가 비었음` **OR** `정규화(멤버주소) == 정규화(keep주소)`.
- 위 조건 불만족(둘 다 주소 있고 명확히 다름) → **병합 보류**하고 `VenueAutoMergeResult`에 skip 사유 기록.

주소 정규화 헬퍼(신규): NFKC → lowercase → 공백 제거 → 건물 세부(층/호/번지 등) 및 특수문자 제거 후 비교. `auto-merge.ts` 내부 또는 `dedup-detect.ts`에 둔다.

반환 타입 `VenueAutoMergeResult`에 `heldBack: Array<{ name, reason }>` 필드 추가(로그·모니터링용).

### ② 후보 탐지 로직 추출 — `lib/venues/dedup-detect.ts` (신규)

현재 `app/api/admin/venues/dedup/route.ts` 안에 인라인된 순수 함수(`normalizeVenueKey`, `tokenizeVenue`, `jaccard`, Stage A/B/C 후보쌍 생성)를 `lib/venues/dedup-detect.ts`로 추출한다.

- 시그니처(예): `detectDuplicateCandidates(venues: VenueBasic[]): VenueDedupCandidate[]` — AI 검증 **이전**의 후보쌍만 반환.
- `route.ts`는 이 함수를 import해서 사용하고 기존 Gemini 검증 래퍼는 그대로 유지(중복 제거).
- 일회성 스크립트도 동일 함수를 import해 Claude 검증에 사용.

### ③ 일회성 정리 스크립트 — `scripts/pipeline/venue-cleanup-claude.ts` (신규)

- 실행: `npx tsx scripts/pipeline/venue-cleanup-claude.ts [--apply]` (인자 없으면 **dry-run**, 아무 쓰기도 하지 않음).
- Claude 클라이언트(`@anthropic-ai/sdk`)와 프롬프트 헬퍼는 이 스크립트 파일 안에만 둔다. 모델 `claude-opus-4-8`, `output_config.effort: "low"`, `thinking: {type:"adaptive"}`, `web_search` 툴 사용.

**Phase 1 — 주소 오염 수정**

1. 오염 행 조회: `address`가 null/빈값이 **아닌** 공연장 중, 아래 중 하나면 오염으로 판정:
   - `정규화(address) == 정규화(name)`, **또는**
   - 주소 키워드 정규식(`시|구|동|로|길|번지|특별시|광역시|도\s|읍|면`) 불일치, **또는**
   - `address.length < 5`.
   (null/빈값 행은 제외 — Gemini 파이프라인 담당.)
2. 각 오염 행 → Claude에 실주소 질의(web_search 그라운딩). `enrich.ts`의 검증 재사용: 키워드 정규식 통과 + 길이 5~150 → 유효.
   - 유효: `address` 갱신, `address_attempted_at = now`.
   - 무효("모름"/검증 실패): `address = null`(잘못된 이름-주소 제거), `address_attempted_at = now`.
3. `--apply` 없으면 각 행의 판정·예정 변경만 출력.

**Phase 2 — 이름 변형 중복 병합**

1. 전체 공연장 로드 → `detectDuplicateCandidates()`로 후보쌍 생성.
2. 각 후보쌍 (이름+주소) → Claude에 "같은 물리적 공연장인가?" 판정(web_search로 대형 공연장 별칭 확인).
   - same → `--apply` 시 `mergeVenues(keepId, mergeId)` 실행(FK 재지정 + 필드 보완 + merge 행 삭제). keep은 event_count 최다.
   - different(같은 이름·다른 주소인 별개 공간 포함) → 유지.
3. dry-run이면 same/different 판정과 병합 예정 쌍만 출력.

**실행 순서**: `--apply` 시 Phase 1(주소) → Phase 2(병합). 주소를 먼저 고쳐야 병합 판정이 정확하다.

### ④ 의존성·환경

- `@anthropic-ai/sdk` 추가(package.json).
- `ANTHROPIC_API_KEY` → `.env.local`(로컬 실행용) + `.env.example`(문서화). 서비스롤 키와 동일하게 클라이언트 노출 금지.

## 명시적 비범위 (안 건드림)

- **DB 스키마 변경 없음**: `address_attempted_at`는 기존 컬럼(`enrich.ts` 사용 중). 따라서 **마이그레이션 불필요**.
- **iOS 동기화 불필요**: venues iOS DTO 미구현이며 스키마 변경도 없음.
- `lib/venues/enrich.ts`(Gemini 상시 보강) 변경 없음.
- `lib/venues/merge.ts`(`mergeVenues`) 변경 없음 — 그대로 재사용.
- 파이프라인 `run-pipeline.ts` 진입점 변경 없음(정리는 별도 일회성 스크립트).

## 검증

- `npm run typecheck` + `npm run lint`.
- 스크립트 dry-run 실측: 오염 행 수·병합 후보 수 출력이 감사 스크립트(`venue-audit.ts`)의 감과 일치하는지 대조.
- `--apply` 후 표본 공연장 주소가 실제 주소로 채워졌는지, 대형 공연장 중복이 하나로 합쳐졌는지 확인.

## 리스크

- **파괴적 병합**: `mergeVenues`는 FK 재지정 후 행을 삭제(하드). dry-run 필수, `--apply`는 명시 인자로만. Claude 오판 시 별개 공간이 합쳐질 수 있음 → dry-run 출력을 사람이 검토 후 apply.
- **Claude 주소 환각**: web_search 그라운딩 + 키워드/길이 검증으로 완화. 검증 실패는 채우지 않고 null 처리.
