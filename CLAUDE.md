# Articket Admin — CLAUDE.md

Next.js 14 App Router + Supabase + TanStack Query 기반 관리 콘솔.

## 관련 레포 (같은 Supabase 프로젝트 공유)

**iOS 앱**: `/Users/sjw/ted.urssu/Articket-iOS`

### DB 변경 시 반드시 양쪽 동기화

Admin에서 Supabase 스키마를 변경하면 **iOS 쪽도 즉시 반영**해야 한다.

| Admin 변경 | iOS 업데이트 대상 |
|---|---|
| `events` 테이블 컬럼 추가/수정 | `Articket-iOS/.../Data/DTO/EventRow.swift` + `Domain/Entity/Event.swift` |
| `artists` 테이블 컬럼 추가/수정 | `Articket-iOS/.../Data/DTO/ArtistRow.swift` + `Domain/Entity/Artist.swift` |
| `venues` 테이블 컬럼 추가/수정 | `Articket-iOS/.../Data/DTO/` 해당 DTO |
| 새 테이블 추가 | iOS에 DTO + Entity + RepositoryProtocol + SupabaseRepository + MockRepository 신규 생성 |
| API 응답 구조 변경 | iOS Repository fetch 쿼리 확인 |

**규칙**: Admin에서 SQL 변경 작업이 끝나면 항상 iOS 레포를 열어서 관련 DTO/Entity가 새 컬럼을 포함하고 있는지 확인한다.

## 프로젝트 구조

```
app/
  api/admin/          API 라우트 (Next.js Route Handlers)
    artists/          아티스트 CRUD
    events/           이벤트 CRUD
    venues/           공연장 CRUD
    timetable/        타임테이블 CRUD
components/
  admin/              페이지 클라이언트 컴포넌트
  ui/                 공통 UI (shadcn/ui 기반)
types/                TypeScript 타입 (DB 스키마 미러)
lib/
  supabase/           클라이언트/서버/서비스롤 클라이언트
```

## 핵심 패턴

- **RLS 우회**: 뮤테이션(INSERT/UPDATE/DELETE) → `createServiceRoleClient()` 사용
- **읽기**: `createClient()` (서버 클라이언트) 사용
- **관리자 확인**: 모든 API 라우트 최상단에 `requireAdmin()` 호출
- **페이지네이션**: `AdminListPagination` + `parseAdminPagination()` 조합

## DB 현재 상태 (주요 테이블)

| 테이블 | 주요 컬럼 | iOS DTO |
|---|---|---|
| `events` | `id, title, has_timetable, is_banner, status, ...` | `EventRow.swift` |
| `artists` | `id, name, avatar_url, followers_count, ...` | `ArtistRow.swift` |
| `venues` | `id, name, address, phone_number` | (미구현) |
| `timetable_performances` | `id, event_id, artist_id, day_number, date_string, start_time, end_time, artist_name, stage_name, genre` | `TimetablePerformanceRow.swift` |
