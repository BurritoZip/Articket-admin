# Articket Admin — CLAUDE.md

Next.js 14 App Router + Supabase + TanStack Query 기반 관리 콘솔.

## 관련 레포 (같은 Supabase 프로젝트 공유)

**iOS 앱**: `/Users/sjw/ted.urssu/Articket-iOS`

---

## DB 관리 원칙

**Migration source of truth**: `supabase/migrations/YYYYMMDDHHMMSS_설명.sql` ← **이 레포에서 관리**

스키마 변경 시 작업 순서:
1. `supabase/migrations/` 에 SQL 파일 추가
2. `types/` 타입 파일 업데이트
3. iOS DTO/Entity Swift 파일 교차 반영 (아래 표 참조)

### DB 변경 시 iOS 레포 동기화 (필수)

Admin에서 Supabase 스키마를 변경하면 **iOS 쪽도 즉시 반영**해야 한다.

| 변경 내용 | iOS 업데이트 대상 |
|---|---|
| `events` 테이블 컬럼 추가/수정 | `Data/DTO/EventRow.swift` + `Domain/Entity/Event.swift` |
| `artists` 테이블 컬럼 추가/수정 | `Data/DTO/ArtistRow.swift` + `Domain/Entity/Artist.swift` |
| `venues` 테이블 컬럼 추가/수정 | 해당 DTO |
| 새 테이블 추가 | DTO + Entity + RepositoryProtocol + SupabaseRepository + MockRepository |
| API 응답 구조 변경 | iOS Repository fetch 쿼리 확인 |

**규칙**: SQL 변경 작업이 끝나면 **즉시** iOS 레포 Swift 파일도 업데이트한다. 나중으로 미루지 않는다.

---

## 프로젝트 구조

```
supabase/
  migrations/       DB 마이그레이션 SQL (source of truth)
  seed.sql          초기 시드 데이터

scripts/
  scraper/          공연 데이터 크롤러 (Python)
    main.py         진입점
    config.py       사이트별 설정
    database.py     Supabase UPSERT 헬퍼
    scrapers/       사이트별 스크래퍼 (stagepick, yes24, melon, ...)
    utils/          정규화·이미지·dedup 유틸
    requirements.txt
    README.md
  supabase/
    rls_policies.sql  RLS 정책 참고용 SQL

app/
  api/admin/        API 라우트 (Next.js Route Handlers)
    artists/        아티스트 CRUD
    events/         이벤트 CRUD
    venues/         공연장 CRUD
    timetable/      타임테이블 CRUD
components/
  admin/            페이지 클라이언트 컴포넌트
  ui/               공통 UI (shadcn/ui 기반)
types/              TypeScript 타입 (DB 스키마 미러)
lib/
  supabase/         클라이언트/서버/서비스롤 클라이언트
```

---

## 핵심 패턴

- **RLS 우회**: 뮤테이션(INSERT/UPDATE/DELETE) → `createServiceRoleClient()` 사용
- **읽기**: `createClient()` (서버 클라이언트) 사용
- **관리자 확인**: 모든 API 라우트 최상단에 `requireAdmin()` 호출
- **페이지네이션**: `AdminListPagination` + `parseAdminPagination()` 조합

---

## DB 현재 상태 (주요 테이블)

| 테이블 | 주요 컬럼 | iOS DTO |
|---|---|---|
| `events` | `id, title, has_timetable, is_banner, status, dedup_key, source_urls, ...` | `EventRow.swift` |
| `artists` | `id, name, avatar_url, followers_count, normalized_name, ...` | `ArtistRow.swift` |
| `venues` | `id, name, address, phone_number, normalized_name, latitude, longitude` | (미구현) |
| `timetable_performances` | `id, event_id, artist_id, day_number, date_string, start_time, end_time, artist_name, stage_name, genre` | `TimetablePerformanceRow.swift` |
| `event_artists` | `id, event_id, artist_id, artist_name, role, display_order` | — |
| `event_venues` | `id, event_id, venue_id, display_order` | — |
| `crawler_jobs` | `id, source_name, status, pages_crawled, events_found, ...` | — |
| `crawler_sources` | `id, name, display_name, base_url, enabled` | — |

Migration 파일 목록: `supabase/migrations/` 참조
