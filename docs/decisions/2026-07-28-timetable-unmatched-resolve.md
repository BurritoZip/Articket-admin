# 미매칭 타임테이블 아티스트 처리(수정·연결·추가·삭제) 설계

**날짜**: 2026-07-28
**상태**: 승인 대기

## 문제

`/admin/timetable-unmatched` 페이지가 미매칭 아티스트를 **로그 조회 + 해결/미해결 토글만** 제공한다(`TimetableUnmatchedPageClient.tsx`). 운영자가 실제로 아티스트를 연결/수정/삭제할 방법이 없다. 원하는 것:
- 이름 수동 수정 → 재매칭
- 관련(기존) 아티스트 추천 → 연결
- 아예 아닌 경우 삭제
- 새 아티스트일 수 있으니 신규 추가 후 연결

## 데이터 관계 (코드 확인됨)

`app/api/admin/timetable/batch/route.ts`: 임포트 시 `matchExistingArtist(name)`가 null이면 `timetable_performances` 행을 `artist_id=null`로 넣고 `logUnmatchedTimetableArtist`로 로그도 남긴다. 따라서:
- 미매칭 로그 `timetable_unmatched_artists`(event_id + artist_name) ↔ `timetable_performances`(같은 event_id + artist_name, artist_id null)가 짝을 이룬다.
- 처리 = **로그 + performance 행 둘 다** 조작.

## 결정 (합의됨)

- 삭제 = 로그 + 타임테이블 performance 행 둘 다 제거.
- 처리 UI = 행 클릭 → 처리 시트/모달.
- 기존 아티스트 연결 시 `artist_id` 설정 **+** performance의 `artist_name`을 그 아티스트 정식명으로 교체(재임포트 자동매칭·표시 일관).
- 신규 아티스트 추가 = **이름만**(name + normalized_name). 프로필은 기존 보강 흐름이 채움.
- 전체 흐름(설계→계획→구현→ship).

## 아키텍처

### ① API — `app/api/admin/timetable/unmatched/route.ts`에 `POST`(resolve) 추가

기존 GET(목록)/PATCH(is_resolved 토글)는 그대로. 새 `POST`는 `action` 기반, 모두 서비스롤로 서버에서 처리. 공통: 로그 행에서 `event_id`+`artist_name`을 읽어 대상 performance 행을 특정(`event_id` = 로그.event_id AND `artist_name` = 로그.artist_name AND `artist_id is null`).

- **link** `{ action:"link", logId, artistId }`
  - 선택 아티스트의 정식명(`artists.name`) 조회.
  - 대상 performance 행 `update({ artist_id: artistId, artist_name: 정식명 })`.
  - 로그 `update({ is_resolved: true })`.
- **create** `{ action:"create", logId, name }`
  - `artists.insert({ name: name.trim(), normalized_name: normalizeArtistName(name) })` → 생성 id.
  - 그 다음 link와 동일(artist_id=새 id, artist_name=name).
  - 로그 resolved.
- **rename** `{ action:"rename", logId, newName }`
  - 대상 performance 행 + 로그 `artist_name = newName` 갱신(대상 특정은 기존 artist_name 기준).
  - `matchExistingArtist(newName)` 재시도:
    - 매칭됨 → 그 id로 link 처리(artist_id + 정식명 교체) + 로그 resolved.
    - 안 됨 → 로그 미해결 유지(이름만 바뀜, is_resolved false).
- **delete** `{ action:"delete", logId }`
  - 대상 performance 행 **삭제**(event_id + artist_name + artist_id null).
  - 로그 행 삭제.

응답: `{ ok, matched?: boolean }`(rename의 재매칭 결과 등). 뮤테이션은 `withErrorHandler` 래퍼.

### ② 추천 검색 — 기존 API 재사용

기존 `GET /api/admin/artists?q=<이름>`(name ilike, id·name 반환)을 시트에서 호출해 후보 표시. **신규 엔드포인트 없음.**

### ③ 라이브러리 — `lib/ingestion/artist-matcher.ts`

`normalizeArtistName`을 `export`로 변경(현재 비export). create 액션의 normalized_name 계산에 재사용. 다른 변경 없음.

### ④ UI

- **`components/admin/UnmatchedResolveSheet.tsx`** (신규): shadcn Sheet/Dialog. props로 미매칭 행 받음. 내부:
  - 헤더: 원문 artist_name + 공연명/스테이지/Day.
  - 이름 수정 `Input`(기본=원문명) + "이 이름으로 재매칭" 버튼 → rename.
  - 추천 아티스트: 마운트 시 `artists?q=원문명` 조회, 후보 각 행에 "연결" 버튼 → link.
  - "신규 아티스트로 추가" 버튼(이름=수정 Input 값) → create.
  - "삭제"(danger) 버튼 → 확인 후 delete.
  - 각 뮤테이션 성공 시 시트 닫고 부모 갱신.
- **`TimetableUnmatchedPageClient.tsx`** 수정: 행에 클릭 핸들러(또는 "처리" 버튼) → 시트 open(선택 행 state). 성공 콜백에서 `admin-timetable-unmatched` + `admin-attention-counts` invalidate. 기존 해결/미해결 토글 버튼은 유지.

## 비범위 (안 건드림)

- 별칭(alias) 영구 매핑 테이블 없음 — 정식명 교체로 재임포트 매칭 커버. **DB 스키마 변경 없음**(마이그레이션·iOS 없음).
- `batch/route.ts`, `logUnmatchedTimetableArtist`, `matchExistingArtist` 로직 변경 없음(matcher는 export 1개만 추가).
- 신규 아티스트 프로필 필드 입력 없음(이름만).

## 검증

- `npm run typecheck` + `npm run lint` + `npm run build`.
- 실측: 미매칭 행 클릭 → (a) 추천에서 연결 → performance artist_id/정식명 반영·로그 resolved, (b) 이름 수정 재매칭 성공/실패 분기, (c) 신규 추가 → artists에 생성·연결, (d) 삭제 → performance 행+로그 제거 확인.

## 리스크

- delete·rename·link는 같은 event의 동일 원문명 performance **전부**에 적용(여러 Day/스테이지). 같은 아티스트이므로 의도된 동작.
- delete는 하드삭제 → 시트에서 확인 다이얼로그 필수.
- rename 재매칭 실패 시 미해결로 남는 것을 UI가 명확히 안내.
