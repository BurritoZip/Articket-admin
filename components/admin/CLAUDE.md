# components/admin/ — 관리자 UI 컴포넌트

## 페이지 클라이언트 (각 admin 페이지의 "use client" 루트)

| 파일 | 역할 |
|---|---|
| `DashboardPageClient.tsx` | 대시보드 — KPI 카드, 파이프라인 실시간 시각화, AI 큐 현황, 보강 진행률 |
| `IngestionPageClient.tsx` | 인제스천 — 워크플로/오류/AI큐/데이터품질 탭 |
| `EventsPageClient.tsx` | 공연 목록·필터·편집 |
| `ArtistsPageClient.tsx` | 아티스트 목록·중복·보강 |
| `VenuesPageClient.tsx` | 공연장 목록·중복 |
| `CrawlerPageClient.tsx` | 크롤러 잡 이력 |
| `UsersPageClient.tsx` | 유저 관리 |

## 시트/모달 컴포넌트

| 파일 | 역할 |
|---|---|
| `ArtistDedupSheet.tsx` | 아티스트 중복 검토 UI |
| `VenueDedupSheet.tsx` | 공연장 중복 검토 UI |
| `TimetableSheet.tsx` | 타임테이블 편집 |

## 공통 유틸 컴포넌트

| 파일 | 역할 |
|---|---|
| `AdminListPagination.tsx` | 페이지네이션 |
| `SortableTableHead.tsx` | 정렬 가능한 테이블 헤더 |
| `MissingFieldChips.tsx` | 누락 필드 배지 |
| `CompletenessFilterBar.tsx` | 완성도 필터 바 |
| `ImageUploader.tsx` | 이미지 업로드 |
