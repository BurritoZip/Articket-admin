# 아티스트 미연결 공연 노출 — 숨김 정책 완화 (C)

작성일: 2026-07-27

## 문제

앱 피드에 보이는 공연이 너무 적다. 특히 내한/신인 공연이 이미 티켓팅 중인데도 안 나온다. 체감상 8월까지만 보인다.

### 진단 (실측)

`events` 테이블 감사 결과:

- 전체 1539개, 숨김 837개, 활성(end_date≥now) 626개.
- **미래(end_date≥now)인데 숨김 = 424개.** 그중 **`unlinked_no_artist` 사유 = 381개.**
- 미래 공연은 2027-01까지 이미 크롤됨 (10월 63, 11월 19, 12월 10, 1월 4). → **크롤 공급 문제 아님.**
- 숨김 381개 샘플 30개 = 전부 포스터 보유, 전부 실제 콘서트: Red Velvet FAN-CON, American Football(내한), 마리아 슈나이더 오케스트라 내한공연, FIFTY FIFTY, 너드커넥션, 홍경민, 브로콜리너마저 등.

### 근본 원인

`lib/data-quality/purge-unlinked.ts`의 정책 "아티스트 연결 안 된 공연은 앱에 안 내보냄". 아티스트 연결(enrich)이 Gemini 의존인데 Gemini 다운 → `no_artist`/연결실패 폭증 → 대량 소프트 숨김. 내한/외국/신인 아티스트가 `artists` 테이블에 없어 특히 많이 걸림.

앱 피드 쿼리(`SupabaseEventRepository.swift`)는 `is_hidden`·status·날짜만 필터하고 **`artist_id`는 안 씀**. 즉 아티스트 없어도 앱은 렌더 가능. 오직 `is_hidden`만 노출을 막고 있다.

## 목표

포스터가 있는 실제 콘서트는 아티스트 연결 여부와 무관하게 노출한다. 아티스트 연결은 백그라운드 best-effort로 유지하고, 연결되면 자동 승격(기존 self-heal).

## 설계 (접근 C)

변경 파일: **`lib/data-quality/purge-unlinked.ts` 한 곳.**

### 1. 숨김 규칙에 가드레일 추가

현재 3개 숨김 조건(`no_artist` status / enrich 시도 후 null / 3일+ 방치 null)에 **`poster_url IS NULL` 조건을 AND로 추가**. 즉 아티스트 미연결이라도 **포스터가 없을 때만** 숨긴다. 포스터 있는 아티스트-미연결 콘서트는 노출 유지.

근거: 비콘서트는 이미 `non_concert` 사유로 별도 숨김 처리됨. 이 단계에 도달한 건 콘서트로 분류된 것들이므로, "포스터 존재"가 실제 노출 가능 콘서트의 충분한 신호다. 포스터 없는 건은 피드 카드가 깨지므로 계속 숨긴다.

### 2. 기존 숨김 해제 (self-heal 확장)

기존 artist_id 기반 unhide 블록에 더해, **`hidden_reason='unlinked_no_artist' AND poster_url IS NOT NULL`** 인 건을 숨김 해제한다. 이게 현재 숨겨진 ~381개(포스터 보유분)를 즉시 노출시킨다. `hidden_reason='unlinked_no_artist'`로 숨긴 것만 건드린다 (180일 purge·병합 숨김은 그대로).

### 3. 백그라운드 연결 유지

enrich 아티스트 연결은 현행 유지. 나중에 artist_id가 부착되면 기존 self-heal이 계속 동작(중복 무해). 정책이 이미 self-heal 구조라 추가 코드 최소.

### 4. 상단 doc 주석 갱신

정책 변경 이유(포스터 가드레일 + Gemini 의존 완화)를 주석에 반영.

## 즉시 반영

`purgeUnlinkedEvents`는 파이프라인 `merge` 단계(`lib/pipeline/run-pipeline.ts:286`)에서 실행됨. 정책 변경 후 파이프라인 merge 1회 수동 실행(또는 함수 직접 호출)으로 ~381개 즉시 노출.

## 범위 밖

- 크롤 공급 확대(스크래퍼 캡 상향, interpark 리스팅) — 미래 공연 이미 충분히 크롤되므로 불필요(YAGNI).
- 오픈예정(`ticket_open_date`) 커버리지 개선 — 별도 스코프.

## 마이그레이션 / iOS

없음. 컬럼(`is_hidden`, `hidden_reason`, `poster_url`) 모두 존재, 앱 피드는 이미 `is_hidden`만 필터.

## 검증

- `npm run typecheck` + `npm run lint`.
- 감사 스크립트 재실행: 활성(end_date≥now) 개수가 ~626 → ~1000으로 급증, 숨김-미래 `unlinked_no_artist`가 포스터 없는 소수만 남는지 확인.
- 포스터 없는 미래 콘서트는 여전히 숨김인지 스팟 체크.
