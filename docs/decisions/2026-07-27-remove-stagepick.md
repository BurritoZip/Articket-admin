# StagePick 완전 제거

작성일: 2026-07-27

## 문제

StagePick은 더 이상 사용하지 않는다. 자동 크롤 파이프라인은 이미 StagePick 없이 6개 소스(yes24/melon/interpark/festivallife/yanolja/gemini-search)로 돌아간다. 그런데 StagePick 잔재가 남아 실제 오류를 낸다:

- 페스티벌 타임테이블 다이얼로그의 "아티스트 자동 생성" 버튼 → `/api/admin/timetable/auto` → `autoImportTimetableForEvent`가 StagePick 공연 ID를 요구 → **"StagePick 공연 ID를 찾을 수 없습니다."** 오류. (운영자가 이미지 올린 뒤 파란 primary 버튼을 누르면 이 죽은 경로를 탄다.)
- 이벤트/아티스트 "URL로 추가"는 StagePick 상세페이지 파서 전용.
- 수동 크롤러 실행(`/admin/crawler`의 실행 패널)은 `crawler/run`이 `case "stagepick"`만 처리 → 사실상 StagePick 전용.

## 목표

StagePick 관련 코드·UI·데이터를 전부 제거한다. 대체는 두지 않는다(사용자 결정):

- 타임테이블: 기존 **이미지 분석(Gemini vision) 경로**로 일원화. (`이미지 분석하기` → `/api/admin/timetable/from-image` → 행 선택 → `/api/admin/timetable/batch`)
- 이벤트 URL 임포트: 제거. 자동 크롤 6개 소스가 커버.
- 아티스트 URL 임포트: 제거. 기존 수동 "아티스트 추가" 폼이 대체.
- 수동 크롤러 실행: 제거. 자동 파이프라인이 대체.

## 설계

### 삭제 (파일 전체)

- `lib/scrapers/stagepick/` — `parser.ts`, `scraper.ts` (디렉토리째)
- `app/api/admin/crawler/run/route.ts` — StagePick 전용(`runStagepickScraper`만 호출)
- `app/api/admin/events/from-url/route.ts`
- `app/api/admin/artists/from-url/route.ts`
- `app/api/admin/timetable/auto/route.ts`
- `lib/ingestion/timetable-auto.ts`

### 편집 (StagePick 부분만 제거)

- **`components/admin/CrawlerPageClient.tsx`** — "크롤러 실행" 수동 실행 패널(`handleRun`, 소스 Select, 실행 버튼, 관련 state)과 하드코딩 `<SelectItem value="stagepick">` 제거. **"실행 이력" 테이블·"소스 관리" 탭은 유지** (PipelineRunsCard가 `/admin/crawler`로 링크). 페이지 자체는 삭제하지 않는다.
- **`components/admin/EventsPageClient.tsx`** — "URL로 공연 추가" 다이얼로그 + from-url fetch 핸들러(:317) 제거.
- **`components/admin/ArtistsPageClient.tsx`** — "URL로 아티스트 추가" 다이얼로그(:1058-1072) + from-url 핸들러(:224) 제거. 일반 "아티스트 추가" 수동 폼(:509/715)은 유지.
- **`components/admin/event-sheet/TimetablePanel.tsx`** — StagePick URL 입력칸(~615-640), `autoSourceUrl`/`autoResult`/`submitAutoImport` state·핸들러, autoResult 표시(642-651), "아티스트 자동 생성" 버튼(903-906) 제거. "이미지 분석하기"를 primary 버튼으로. 다이얼로그 부제 "StagePick URL 또는 타임테이블 이미지로..." → 이미지 전용 문구로. "시간 직접 입력하기" 수동 폴백은 유지.
- **`lib/ingestion/source-trust.ts`** — `stagepick: 60` 줄 제거. `trustOf()`가 미지 소스에 `DEFAULT_TRUST=50` 반환하므로 무해.
- **`components/admin/DashboardPageClient.tsx:107`** — `desc: "stagepick"` 항목 제거/교체.
- **`components/admin/TimetableUnmatchedPageClient.tsx:54`** — 배지 라벨 "자동(StagePick)" → 일반 라벨("자동" 등).
- **`lib/ingestion/event-auto-merge.ts:510`** — StagePick 예시 주석 제거(cosmetic).

### 마이그레이션

- 새 파일 `supabase/migrations/<ts>_remove_stagepick_source.sql`: `DELETE FROM crawler_sources WHERE name='stagepick';` — "소스 관리" 탭에서 사라지게. 기존 마이그레이션은 불변이라 수정하지 않는다.

## 커플링 확인 (조사 완료)

- `lib/scrapers/stagepick/parser.ts` = scraper.ts + 두 from-url 라우트가 공유 → 세 소비자 모두 이번에 삭제되므로 디렉토리 삭제 안전.
- `crawler/run` 유일 소비자 = CrawlerPageClient(제거 대상).
- `timetable/auto` 유일 소비자 = TimetablePanel(제거 대상).
- 자동 파이프라인(`run-pipeline.ts` SCRAPERS)엔 stagepick 없음 → 크롤 무영향.

## iOS

없음 (스키마 변경 없음).

## 검증

- `npm run typecheck` + `npm run lint`.
- `grep -ri stagepick`(node_modules/.next 제외) 잔재 0 — 주석·라벨·마이그레이션 히스토리 제외.
- 수동 확인: `/admin/crawler`(실행 이력+소스 관리 로드), 이벤트/아티스트 페이지(URL 추가 버튼 사라짐, 일반 추가 동작), 타임테이블 다이얼로그(이미지 분석 primary, StagePick 흔적 없음).
