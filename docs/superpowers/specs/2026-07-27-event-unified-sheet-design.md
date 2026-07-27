# 이벤트 화면 4→1 통합 — 탭 하나의 이벤트 시트 설계

**작성일**: 2026-07-27
**브랜치**: `feat/event-unified-sheet`
**상태**: 설계 확정, 구현 대기

## 문제

이벤트 하나를 다루는 UI 가 `EventsPageClient.tsx`(~1400줄)에 오버레이 3개로 흩어져 있다:
상세 시트(읽기) · 편집 다이얼로그(폼) · TimetableSheet(타임테이블). 이벤트를 보다가
편집하려면 상세를 닫고 편집을 열어야 하고, 타임테이블은 또 다른 시트다. 오버레이를
저글링하는 마찰 + 편집 폼이 생성/편집 두 곳에 중복.

## 목표

- 이벤트 하나 = **탭 하나의 시트**([상세][편집][타임테이블])로 통합. 오버레이 저글링 제거.
- 생성(공연 추가)도 같은 시트의 **편집 탭(빈 폼)** 으로 → 편집 폼 코드 1곳 통일(생성=빈편집).
- EventsPageClient 를 목록 + 인라인 액션 + 진입점으로 축소, 이벤트 UI 를 `EventSheet` 로 응집.

## 비목표

- 목록(테이블) 자체 재설계 안 함(유지).
- 중복 검토 시트·URL로 추가는 통합 대상 아님(그대로). 단 URL로 추가는 통합 시트 편집 탭을
  prefill 로 여는 방식으로 자연 연결.
- 목록 인라인 액션(상태 Select·배너·숨김·삭제·벌크)은 시트 밖에 그대로.

## 아키텍처

### 컴포넌트

- **`components/admin/event-sheet/EventSheet.tsx`** (신규) — 탭 컨테이너. 상태: 활성 탭,
  편집 폼, dirty 플래그. props: `{ event: EventRow | null; open; onOpenChange; defaultTab; onSaved; prefill? }`.
  `event === null` = 생성 모드.
  - 상세 탭이면 열 때 `GET /api/admin/events/{id}` 로 전체 행(점수/출처/잠금 포함) 로드.
- **`EventDetailTab`** — 읽기 뷰(기본 정보 그리드·포스터·공지) + 점수 상세/필드 출처/잠금
  필드 패널. (현 상세 시트 내용 이동.)
- **`EventEditTab`** — 이벤트 폼(제목·아티스트·공연장·날짜·상태·장르·러닝타임·연령·예매·공지·배너).
  생성+편집 통일: `event=null` → `POST /api/admin/events`, 있으면 `PATCH /api/admin/events/{id}`.
- **`EventTimetableTab`** — 타임테이블 편집. **`TimetableSheet` 본문을 `TimetablePanel` 로 추출**해
  Sheet 래퍼 없이 탭에 렌더. 기존 `TimetableSheet`(다른 호출부 있으면) 도 `TimetablePanel` 재사용.

### EventsPageClient 진입점

- 목록 행 클릭(상세 보기) → `openEventSheet(event, "상세")`
- 공연 추가 → `openEventSheet(null, "편집")` (빈 폼)
- URL로 추가 → 스크랩 후 `openEventSheet(null, "편집", { prefill })`
- 중복 검토 → 그대로 별도(`EventDedupSheet`)

## 상태·데이터 흐름

### EventsPageClient 상태 (수렴)

기존 `detailOpen/editOpen/timetableOpen/createOpen/detailEvent/editingEvent/timetableEvent` 등
다수를 아래 3개로 대체:
- `sheetEvent: EventRow | null` (null = 생성)
- `sheetOpen: boolean`
- `sheetTab: "상세" | "편집" | "타임테이블"`
- (URL prefill 용 `sheetPrefill?: Partial<EventRow>` 선택)

편집 폼 상태는 EventSheet 내부에 둔다(EventsPageClient 밖).

### 저장

- **생성**: 편집 탭 저장 → `POST /api/admin/events` → 반환 id 로 `sheetEvent` 갱신(이제 수정 모드)
  → 상세 탭 전환 → 목록 `refetch` + `admin-events-stats` invalidate.
- **수정**: 저장 → `PATCH /api/admin/events/{id}` → 상세 탭 전환 → 목록 refetch.
- 저장 실패: `res.ok` 체크 → 편집 탭 유지 + 에러 토스트.

### 생성 모드 타임테이블

타임테이블은 `event_id` 가 있어야 편집 가능 → 생성 모드(event=null)엔 **타임테이블 탭 비활성**
+ "저장 후 편집 가능" 힌트. 첫 저장(생성→수정 전환) 후 활성화.

### 변경 가드

편집 탭에 미저장 변경(dirty)이 있는 채로 탭 이동/시트 닫기 → 확인 다이얼로그
("저장하지 않은 변경이 있습니다. 나가시겠어요?"). 취소 시 편집 탭 유지.

### 에러 핸들링

- GET 상세 실패 → 목록 행 데이터로 폴백(패널만 빈 상태).
- POST/PATCH 실패 → 토스트 + 편집 탭 유지.
- 타임테이블 저장 실패 → 기존 TimetableSheet 에러 처리 계승.

## 롤아웃 (증분 — 각 단계 앱 동작 유지, 빌드 그린)

1. **EventEditTab 추출** — 현 생성 다이얼로그 + 편집 다이얼로그 폼을 하나의 `EventEditTab` 로.
   생성/편집 양쪽이 이 컴포넌트를 쓰게. (아직 다이얼로그 안에서.) 생성·수정 동작 확인.
2. **EventDetailTab 추출** — 현 상세 시트 내용(패널 포함)을 `EventDetailTab` 로.
3. **EventSheet 셸** — 탭 컨테이너 만들고 상세·편집 탭 마운트, 진입점(목록/추가/URL) 배선.
   옛 상세 시트 + 편집 다이얼로그 제거.
4. **TimetablePanel 추출 + 타임테이블 탭** — `TimetableSheet` 본문 분리, 타임테이블 탭에 렌더.
   옛 `TimetableSheet` 별도 마운트 제거(기존 호출부는 TimetablePanel 재사용).
5. **EventsPageClient 상태 정리** — 죽은 state/핸들러 제거, sheet 3개 state 로 수렴.

## 검증 (테스트러너 없음)

- 각 단계 `npm run typecheck` + `npx next lint` + `npm run build` 그린.
- 상태 전이 수기 추적: 생성→저장→수정 전환, dirty 가드, 탭별 데이터 로드, URL prefill.
- (선택) Playwright e2e 1개: 목록→상세→편집 저장→타임테이블 플로우.

## 스코프 밖 (후속)

- 목록 테이블 재설계.
- ticket_open_date 시각 보존(별도).
