# Ingest 중복 방지 — 정규화 통일 설계

**작성일**: 2026-07-27
**브랜치**: `feat/ingest-dedup-unification`
**상태**: 설계 확정, 구현 대기

## 문제

크롤 데이터가 이미 있는 공연/아티스트/공연장과 겹칠 때, ingest 는 이미 **upsert(있으면 변경분만 UPDATE, 없으면 INSERT)** 로 동작한다. 재삽입은 안 한다. 그러나 매칭 **키가 "정확 일치"** 라서 표기가 조금만 달라도 매칭에 실패하고 새 행이 생긴다:

- 이벤트 `dedup_key = SHA256(normalizedTitle | venue | date)` 인데 `normalizedTitle` 정규화가 약하다(lowercase+trim 수준). 한/영·띄어쓰기·`[도시]` 접두·소스별 포맷·**티켓팅 분할(얼리버드/일반/1차 라인업/VIP/스탠딩/지정석/크루)** 로 제목이 갈리면 다른 키 → 신규 insert.
- 아티스트 `normalized_name` 정확 일치 → 크로스스크립트(한↔영)·오탈자에서 신규 생성.

결과: 같은 공연/아티스트가 여러 행으로 쌓이고, 이를 downstream auto-merge(8패스) + 수동 dedup 시트로 사후 청소한다. 운영자가 중복을 직접 찾아 병합하는 부담이 크다.

## 목표

1. **원천 차단**: 강한 정규화로 표기 변형을 ingest 시점에 같은 키로 모아 update-only 처리 → 중복이 애초에 안 생김.
2. **티켓팅 분할 인식**: 같은 공연이 티켓 종류/라인업 차수로 갈린 리스트를 한 공연으로 매칭. (핵심 요구)
3. **자동 정리**: 운영자가 안 찾아도 되게, 강한 키 충돌 병합을 파이프라인에 상시화. 수동 시트는 축소된 backstop.
4. **과거 데이터도 정리**: 재계산 마이그레이션으로 기존 중복 collapse.

## 비목표 / 한계 (정직)

- **fuzzy/유사도 매칭은 ingest 에 넣지 않는다.** false merge(서로 다른 공연·아티스트를 하나로 뭉갬)는 되돌리기 어렵다. 결정적 정규화만 자동화하고, 애매한 fuzzy 는 기존 auto-merge(날짜-gated) + 수동 시트가 계속 담당.
- **아티스트는 효과 제한적**: 크로스스크립트(한↔영, HYANG↔향)는 문자가 달라 정규화로 못 합친다. alias + enrich(canonical) + 수동이 계속 근본 담당. 이 작업의 아티스트 변경은 NFKC 정도의 소폭.
- **티켓팅 분할인데 날짜가 서로 다르게 크롤된 경우**(1차 라인업 placeholder 날짜 등)는 키가 달라 ingest 에서 못 잡음 → auto-merge/수동 잔여 처리.
- **1부/2부·낮공/밤공·1일권/2일권** 은 보존한다(진짜 별개 회차). 정규화가 일부러 이 마커는 안 뗀다.

## 아키텍처

정규화가 4곳에 흩어져 제각각이다. 이를 **공용 모듈 하나로 통일**하고, 이벤트 매칭 키에 marker-aware 강한 정규화를 쓴다.

| 위치 | 현재 강도 | 변경 |
|---|---|---|
| `lib/ingestion/dedup.ts` `generateDedupKey` | 약함(lowercase+trim) | 공용 강한 정규화 사용 |
| `lib/ingestion/event-auto-merge.ts` `normTitle`/`coreKey`/`festPrefix` | 강함·marker-aware (여기 갇힘) | 공용 모듈로 승격 후 import |
| `lib/artists/normalize.ts` `normalizeKey` | 중간(NFC) | NFKC 로 소폭 강화 |
| `lib/ingestion/normalize.ts` `normalizeVenueName` | 중간 | NFKC+기호 정규화 소폭 |

### 신규 공용 모듈: `lib/ingestion/match-key.ts`

auto-merge 에 갇혀 있던 marker-aware 정규화를 승격해 단일 소스로 만든다.

- `strongTitleKey(rawTitle: string): string`
  - NFKC 정규화(전각→반각) → lowercase → 영숫자+한글만 남기고 기호 제거
  - **도시 마커 제거**: 앞 `[도시]`, 뒤 `- 도시` (auto-merge `coreKey` 로직). 단 티켓 마커(`[스탠딩]`/`[지정석]`/`[VIP]` 등)는 안 뗌
  - **listing 마커 제거**: `- 얼리버드/일반/티켓/발표/개최/N차/크루/오픈/라인업` 등 (auto-merge `festPrefix`/`LISTING` 로직)
  - **보존**: `1부/2부`, `낮공/밤공`, `1일권/2일권` (별개 회차 신호)
- `eventDedupKey(rawTitle, normalizedVenueName, startDate): string`
  - `SHA256(strongTitleKey(rawTitle) | venue | date).slice(0,32)` — 기존 `generateDedupKey` 시그니처 호환 대체
  - **공연장+날짜가 앵커** → 마커만 떼도 날짜·공연장이 다르면 안 합쳐짐(전국투어·다른 날 보존)

`event-auto-merge.ts` 는 자체 `normTitle`/`coreKey`/`festPrefix` 를 삭제하고 `strongTitleKey` 를 import 한다. **동작 동일해야 함(회귀 없음)** — 이게 롤아웃 게이트.

### self-check

`match-key.ts` 에 `demo()` 를 두고 `npx tsx` 로 실행 가능한 assert 자기검증:
- 티켓팅 분할 → 같은 키: `"2026 X 페스티벌 - 얼리버드"` == `"2026 X 페스티벌 - 1차 라인업"` == `"2026 X 페스티벌 일반"` (동일 날짜·공연장 가정)
- 도시 마커 흡수: `"[부산] Y 콘서트"` == `"Y 콘서트 - 부산"`
- 회차 보존: `strongTitleKey("Z 콘서트 1부")` != `strongTitleKey("Z 콘서트 2부")`
- 전각/반각: `"［서울］"` == `"[서울]"`

## 엔티티별 변경

### 이벤트 (효과 최대)
- `dedup.ts`: `generateDedupKey` → `eventDedupKey`(강한 정규화). 시그니처 유지, 호출부 무변경.
- `normalize.ts` (약 191번째 줄): `generateDedupKey(...)` 호출을 `eventDedupKey(displayTitle, normalizedVenueName, startDate)` 로. (원본 제목을 넘겨 strongTitleKey 가 마커 처리)
- `upsert.ts`: 매칭 로직 그대로(dedup_key 우선 + normalized_title 폴백). **추가**: INSERT 가 `dedup_key` UNIQUE(23505) 로 실패하면 — 강한 키 충돌 = 사실상 같은 공연 — throw 대신 그 키로 기존 행을 refetch 해 UPDATE 경로로 폴백. (지금은 throw)
- `event-auto-merge.ts`: 공용 모듈 import(위).

### 아티스트 (소폭)
- `lib/artists/normalize.ts` `normalizeKey`: `.normalize("NFC")` → `.normalize("NFKC")`. 전각/반각·호환문자 흡수.
- **주의**: `normalizeKey` 는 아티스트 매칭·dedup 전반에 쓰인다. NFKC 변경은 기존 `normalized_name` 과 새 계산이 어긋날 수 있어 **아티스트 normalized_name 도 재계산 대상**(아래 마이그레이션에 포함). 크로스스크립트는 여전히 alias/enrich 담당.

### 공연장 (소폭)
- `matchOrCreateVenue` 의 `normalizeVenueName` 에 NFKC+기호 정규화 추가. 티켓 suffix 제거는 유지. 공연장 `normalized_name` 재계산 포함.

## 자동화 — 상시 정리

운영자가 중복을 안 찾게 3겹으로 개입 제거:

1. **ingest 차단**: 강한 키로 크롤 시점에 같은 공연이면 새 행 안 생김.
2. **파이프라인 상시 collapse**: 재계산+collapse 로직을 1회 스크립트가 아니라 **파이프라인 merge 단계**(`lib/pipeline/run-pipeline.ts` 의 `merge`)에서 매 run(하루 2회) 수행. 새로 샌 강한-키 충돌도 다음 run 이 자동 흡수. `absorbEvents()`(기존 `event-auto-merge.ts` 헬퍼) 재사용.
3. **수동 시트 = backstop**: 강한 키로 못 잡는 fuzzy 만 시트에 남음(대폭 감소). `EventDedupSheet`/`ArtistDedupSheet` 유지.

**안전 경계**: 강한 키는 결정적(공연장+날짜 앵커)이라 자동 적용해도 false merge 위험 낮다. 애매한 fuzzy 는 자동 안 하고 시트로.

## 마이그레이션 — 재계산 스크립트

`scripts/pipeline/recompute-match-keys.ts` (1회, 재실행 가능/idempotent):

**이벤트** (dedup_key 가 UNIQUE 라 순서 중요):
1. 활성 이벤트(`merged_into_event_id IS NULL`, `is_hidden=false`) 전체 fetch.
2. 각 새 `eventDedupKey` 계산 → 새 키로 그룹핑.
3. 그룹 크기 2+ = 기존 중복 → `absorbEvents(db, canonId, otherIds, "recompute_collapse")` 로 흡수(canonical 은 auto-merge `pickCanonical` 기준). 흡수 행은 삭제되고 `event_merge_logs` 스냅샷 남음(복구 가능).
4. 그룹의 **생존(canonical) 행에만** 새 dedup_key 를 UPDATE. (충돌 행이 이미 삭제됐으므로 UNIQUE 안전)
5. `--dry` 로 "몇 그룹·몇 건 합쳐질지" 먼저 출력.

**아티스트/공연장**: `normalized_name` 재계산 UPDATE. 재계산으로 같은 normalized_name 이 된 중복은 기존 auto-merge(`autoMergeExactArtists`) / 수동 시트가 정리(이 스크립트는 키만 갱신, 병합은 기존 경로).

## 롤아웃 순서 (안전, 회귀 방지)

1. `match-key.ts` + `demo()` self-check 작성·통과.
2. `event-auto-merge.ts` 가 공용 모듈 import → **auto-merge 동작 동일 확인**(기존 자동병합 결과 회귀 없어야). typecheck+lint.
3. `dedup.ts`/`normalize.ts` 이벤트 키를 강한 키로 교체 + `upsert.ts` 23505 방어.
4. `recompute-match-keys.ts` **`--dry` 실측** → 합쳐질 건수·샘플 확인 → 사용자 확인 후 실행.
5. 파이프라인 merge 단계에 상시 collapse 추가.
6. 아티스트/공연장 NFKC + normalized_name 재계산.

각 단계 검증: typecheck + lint + 스크립트 실측(테스트러너 없음).

## 스코프 밖 (별도 후속)

- **관리자 버튼 전수 검증**: "버튼들이 제대로 작동하는지 모르겠다"는 불신 해소용. 보강(일괄/외부소스)·dedup·merge·이름제안·이벤트 dedup 각 버튼 → API → 실제 DB 효과까지 실측 감사. 이 스펙 구현 후 별도 패스로.

## 검증 기준

- `match-key.ts` `demo()` assert 통과 (티켓팅분할 병합 / 회차 보존 / 전각반각 / 도시마커).
- auto-merge import 전환 후 동작 회귀 없음(샘플 이벤트로 병합 결과 비교).
- `recompute --dry` 가 기존 중복을 합리적으로 잡고, 명백한 오병합(다른 공연장·회차) 없음.
- typecheck + lint 통과.
