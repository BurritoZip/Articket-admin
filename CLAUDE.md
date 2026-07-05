# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Articket Admin — Next.js 14 App Router + Supabase + TanStack Query 관리 콘솔.
크롤 → 정제 → 보강(Gemini) → 병합 데이터 파이프라인을 운영자가 트리거/모니터링하는 백오피스.

## 명령어

```bash
npm run dev        # 개발 서버 (localhost:3000 → /admin/dashboard 리다이렉트)
npm run build      # 프로덕션 빌드 (next build) — Vercel 빌드와 동일
npm run lint       # next lint (eslint)
npm run typecheck  # tsc --noEmit (테스트 러너 없음 — 타입체크가 1차 검증)

npx tsx scripts/pipeline/run.ts          # 전체 파이프라인 로컬 실행 (서비스롤 키 필요)
npx tsx scripts/pipeline/missing-audit.ts # 누락 데이터 감사 (다른 audit/cleanup 스크립트도 동일 패턴)
```

테스트 프레임워크 없음. 검증은 `typecheck` + `lint` + 파이프라인 스크립트 실측으로 한다.

## 환경 변수

`.env.example` 복사해 `.env.local` 작성. 필수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`.
서비스롤 키는 절대 클라이언트에 노출 금지. 배포 리전 `icn1`(서울).

## 관련 레포 (같은 Supabase 프로젝트 공유)

**iOS 앱**: `/Users/sjw/ted.urssu/Articket-iOS`

---

## 데이터 파이프라인 (핵심 아키텍처)

운영자가 크롤·정제·보강을 8단계 파이프라인으로 돌린다. 단계 이름은 `lib/db/pipeline-tracker.ts`의
`PipelineStep` 타입과 일치하며 `pipeline_step_status` 테이블에 진행상태가 기록된다(대시보드가 1.5초 폴링).

| 순서 | 단계 | 동작 | 주요 모듈 |
|---|---|---|---|
| 1 | `crawl` | enabled 크롤러 소스 스크래핑 (현재 stagepick) | `lib/scrapers/`, `lib/crawler/job-manager` |
| 2 | `sweep` | end_date 기준 이벤트 상태 일괄 갱신 | `lib/db/status-sweeper` |
| 3 | `fix` | 이상 필드 자동 수정 | `lib/data-quality/auto-fix` |
| 4 | `delete` | 불량 데이터 삭제 | `lib/data-quality/auto-delete` |
| 5 | `enrich` | 아티스트 backfill + Gemini 보강(아티스트/장르/연령/공연장 주소). 미시도 + `REENRICH_STALE_DAYS`(7일) 지난 활성 공연 재보강 | `lib/ingestion/event-enrich`, `lib/artists/enrich`, `lib/venues/enrich` |
| 6 | `merge` | 정확 일치 아티스트·공연장 자동 병합 | `lib/artists/auto-merge`, `lib/venues/auto-merge` |
| 7 | `score` | 인기·트렌드 점수 산출 | `lib/scoring/run` |
| 8 | `purge` | 종료 후 `PURGE_ENDED_AFTER_DAYS`(180일) 지난 공연 소프트 숨김(`is_hidden`, 하드삭제 아님) | `lib/data-quality/purge-old-events` |

**진입점 (같은 8단계, 세 경로):**
- `app/api/admin/pipeline/run/route.ts` — UI/수동 트리거 (`maxDuration=300`). enrich를 큐 우회 직접 보강으로 처리.
- `scripts/pipeline/run.ts` — 로컬 launchd cron이 `npx tsx`로 호출. enrich를 큐 드레인으로 처리.
- `app/api/admin/crawler/cron/route.ts` — Vercel/launchd cron(curl) 엔트리포인트.

세 진입점 모두 같은 `lib/` 함수를 호출하므로 **파이프라인 단계 추가/수정 시 세 곳 다 반영**해야 한다.

**enrich 단계 = Gemini.** `lib/gemini.ts`의 `geminiText(prompt, model="gemini-2.5-flash")`가 공용 클라이언트.
보강은 `ai_processing_queue` 테이블에 entity(artist/event)를 적재 후 배치 처리.

**로컬 cron**: Vercel Pro 없이 macOS launchd로 실행. 네이밍이 직관과 반대라 주의:
- **실사용 잡** = `com.articket.cron.python` → `trigger-python.sh` → `npx tsx scripts/pipeline/run.ts` **로컬 실행** (하루 2회 06:00/18:00 KST). `install-python.sh`로 설치.
- 대체 잡 = `com.articket.cron`(현재 `.disabled`) → `trigger.sh` → `curl`로 Vercel `/api/admin/crawler/cron` 호출. 실사용 잡과 동시 로드 시 파이프라인 **중복 실행**되므로 켜지 말 것.
- `RunAtLoad=false` — 노트북 취침 중 놓친 배치는 스킵된다(깨어날 때 자동 catch-up 안 함). 아침 배치 유실 방지하려면 `RunAtLoad=true` 후 재로드.

**레거시**: `scripts/scraper/` (Python). 현재 프로덕션 파이프라인은 TS(`lib/scrapers/`). Python 코드는 참고용 — 신규 작업은 TS 쪽에 한다.

---

## 디렉토리별 CLAUDE.md (상세 지도)

각 디렉토리에 모듈 지도가 있다. 해당 영역 작업 전 먼저 읽을 것:

- `lib/CLAUDE.md` — 서버 비즈니스 로직 전체 모듈 지도
- `lib/ingestion/`, `lib/data-quality/`, `lib/artists/`, `lib/venues/`, `lib/crawler/`, `lib/scrapers/`, `lib/db/`, `lib/supabase/` — 각 영역 상세
- `app/api/admin/CLAUDE.md` — API 라우트 지도
- `components/admin/CLAUDE.md` — 페이지 컴포넌트
- `supabase/migrations/CLAUDE.md`, `types/CLAUDE.md`, `scripts/scraper/CLAUDE.md`

---

## 핵심 패턴


- **RLS 우회**: 뮤테이션(INSERT/UPDATE/DELETE) → `createServiceRoleClient()` (`lib/supabase/`)
- **읽기**: `createClient()` (서버 클라이언트)
- **관리자 확인**: 모든 API 라우트 최상단 `requireAdmin()` → 실패 시 즉시 return
- **에러 핸들링**: 뮤테이션 라우트는 `withErrorHandler()` (`lib/api-handler.ts`) 래퍼
- **페이지네이션**: `AdminListPagination` + `parseAdminPagination()`
- **임포트**: `@/*` → 레포 루트 (tsconfig paths)

---

## DB 관리 원칙

**Migration source of truth**: `supabase/migrations/YYYYMMDDHHMMSS_설명.sql` ← **이 레포에서 관리**

스키마 변경 작업 순서:
1. `supabase/migrations/` 에 SQL 파일 추가
2. `types/` 타입 파일 업데이트
3. iOS DTO/Entity Swift 파일 교차 반영 (아래 표)

### DB 변경 시 iOS 레포 동기화 (필수)

Admin에서 Supabase 스키마 변경 시 **iOS 쪽도 즉시 반영**. 나중으로 미루지 않는다.

| 변경 내용 | iOS 업데이트 대상 |
|---|---|
| `events` 컬럼 추가/수정 | `Data/DTO/EventRow.swift` + `Domain/Entity/Event.swift` |
| `artists` 컬럼 추가/수정 | `Data/DTO/ArtistRow.swift` + `Domain/Entity/Artist.swift` |
| `venues` 컬럼 추가/수정 | 해당 DTO |
| 새 테이블 추가 | DTO + Entity + RepositoryProtocol + SupabaseRepository + MockRepository |
| API 응답 구조 변경 | iOS Repository fetch 쿼리 확인 |

### 주요 테이블

| 테이블 | 주요 컬럼 | iOS DTO |
|---|---|---|
| `events` | `id, title, has_timetable, is_banner, status, dedup_key, source_urls, popularity_score, trending_score, score_breakdown, artist_link_status, enrich_attempted_at, ticket_checked_at, age_checked_at, is_hidden, hidden_at, hidden_reason, ...` | `EventRow.swift` |
| `artists` | `id, name, avatar_url, followers_count, normalized_name, popularity_score, trending_score, description, is_music_artist, gemini_canon, gemini_checked_at, ...` | `ArtistRow.swift` |
| `venues` | `id, name, address, phone_number, normalized_name, latitude, longitude` | (미구현) |
| `timetable_performances` | `id, event_id, artist_id, day_number, date_string, start_time, end_time, artist_name, stage_name, genre` | `TimetablePerformanceRow.swift` |
| `event_artists` | `id, event_id, artist_id, artist_name, role, display_order` | — |
| `event_venues` | `id, event_id, venue_id, display_order` | — |
| `crawler_jobs` / `crawler_sources` | 크롤 잡 추적 / enabled 소스 정의 | — |
| `ai_processing_queue` | enrich 큐 (entity_type artist/event, status pending/...) | — |
| `pipeline_step_status` | 파이프라인 단계별 실행 상태 | — |
