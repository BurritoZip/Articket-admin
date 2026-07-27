# StagePick 완전 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** StagePick 관련 코드·UI·데이터를 전부 제거한다. 타임테이블은 이미지 분석 경로로 일원화, 나머지 StagePick 전용 기능은 대체 없이 제거.

**Architecture:** StagePick 전용 라우트/라이브러리/스크래퍼를 삭제하고, StagePick을 참조하는 UI에서 해당 부분만 잘라낸다. 자동 크롤 파이프라인은 이미 StagePick 없이 6개 소스로 동작하므로 크롤 무영향. 타입체크가 잔여 참조(미사용 import/변수)를 잡는 안전망.

**Tech Stack:** TypeScript, Next.js(App Router), Supabase. 테스트 프레임워크 없음 — 검증 = `npm run typecheck` + `npm run lint` + `grep -ri stagepick` + 페이지 수동 로드.

## Global Constraints

- 기존 마이그레이션 파일은 불변 — 절대 수정하지 않는다. 스키마/데이터 변경은 새 마이그레이션 파일로만.
- `/admin/crawler` 페이지 자체는 유지(실행 이력·소스 관리 탭). 수동 실행 패널만 제거.
- `ArtistsPageClient`의 일반 "아티스트 추가" 수동 폼은 유지. "URL로 아티스트 추가"만 제거.
- `TimetablePanel`의 "시간 직접 입력하기" 수동 폴백은 유지.
- iOS 변경 없음.
- 스펙: `docs/decisions/2026-07-27-remove-stagepick.md`.
- 각 task 종료 시 `npm run typecheck && npm run lint` 통과 후 커밋.

---

### Task 1: 백엔드 StagePick 삭제 (라우트 + 라이브러리 + 스크래퍼)

**Files:**
- Delete: `app/api/admin/events/from-url/route.ts`
- Delete: `app/api/admin/artists/from-url/route.ts`
- Delete: `app/api/admin/crawler/run/route.ts`
- Delete: `app/api/admin/timetable/auto/route.ts`
- Delete: `lib/ingestion/timetable-auto.ts`
- Delete: `lib/scrapers/stagepick/parser.ts`, `lib/scrapers/stagepick/scraper.ts` (디렉토리째)

**Interfaces:**
- Produces: 위 라우트/모듈이 더 이상 존재하지 않음. 소비자는 Task 2~4에서 제거(UI는 import가 아니라 fetch라 타입체크엔 영향 없음).

- [ ] **Step 1: 커플링 재확인 (삭제 안전성)**

Run: `grep -rn "stagepick/parser\|stagepick/scraper\|timetable-auto\|autoImportTimetableForEvent\|runStagepickScraper" app lib components --include="*.ts" --include="*.tsx"`
Expected: 매칭이 이번에 삭제할 파일들 내부뿐(외부 import 없음). 만약 예상 밖 소비자가 나오면 멈추고 보고.

- [ ] **Step 2: 파일/디렉토리 삭제**

```bash
rm -f app/api/admin/events/from-url/route.ts
rm -f app/api/admin/artists/from-url/route.ts
rm -f app/api/admin/crawler/run/route.ts
rm -f app/api/admin/timetable/auto/route.ts
rm -f lib/ingestion/timetable-auto.ts
rm -rf lib/scrapers/stagepick
```
그 후 빈 디렉토리 정리: `rmdir app/api/admin/events/from-url app/api/admin/artists/from-url app/api/admin/crawler/run app/api/admin/timetable/auto 2>/dev/null || true`

- [ ] **Step 3: 타입체크 + 린트**

Run: `npm run typecheck && npm run lint`
Expected: 통과. (UI의 `fetch("/api/admin/...")`는 런타임 문자열이라 타입 에러 없음. import 에러가 나면 삭제 대상 외 소비자가 있는 것 → Step 1로 복귀.)

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "chore: StagePick 백엔드 제거 (from-url·crawler/run·timetable/auto·scraper)"
```

---

### Task 2: TimetablePanel — StagePick 제거 + 이미지 분석 primary화

**Files:**
- Modify: `components/admin/event-sheet/TimetablePanel.tsx`

**Interfaces:**
- Consumes: 남는 이미지 경로 `/api/admin/timetable/from-image` + `/api/admin/timetable/batch`(불변).

- [ ] **Step 1: StagePick auto 관련 코드 제거**

다음을 모두 삭제한다:
- state: `autoSourceUrl`/`setAutoSourceUrl`(:83), `autoResult`/`setAutoResult`(:84~) 및 관련 `autoImporting` 류 state
- 핸들러: `submitAutoImport`(:279~, `/api/admin/timetable/auto` fetch 포함)
- JSX: "StagePick URL" 입력 블록(placeholder `https://www.stagepick.co.kr/...`, ~615-640), `autoResult` 표시 블록(642-651), "아티스트 자동 생성" 버튼(903-906)

- [ ] **Step 2: 이미지 분석 버튼을 primary로 + 부제 문구 수정**

- "이미지 분석하기" 버튼(:733 부근)을 primary 스타일로 승격(예: `variant="default"` 또는 기존 primary 버튼이 쓰던 클래스). "아티스트 자동 생성"이 쓰던 primary 자리를 대체.
- 다이얼로그 부제 "StagePick URL 또는 타임테이블 이미지로 공연 정보를 자동으로 가져옵니다." → "타임테이블 이미지로 공연 정보를 자동으로 가져옵니다."

- [ ] **Step 3: 타입체크 + 린트**

Run: `npm run typecheck && npm run lint`
Expected: 통과. (미사용 state/import 남으면 여기서 에러 → 제거.)

- [ ] **Step 4: 커밋**

```bash
git add components/admin/event-sheet/TimetablePanel.tsx
git commit -m "feat: 타임테이블 이미지 분석 일원화, StagePick auto 제거"
```

---

### Task 3: 이벤트/아티스트 URL 임포트 제거

**Files:**
- Modify: `components/admin/EventsPageClient.tsx`
- Modify: `components/admin/ArtistsPageClient.tsx`

**Interfaces:**
- Consumes: 없음(제거만).

- [ ] **Step 1: EventsPageClient — "URL로 공연 추가" 제거**

- `/api/admin/events/from-url` fetch 핸들러(:317 부근) 및 관련 state 제거.
- "공연 URL" 입력 다이얼로그(:1024-1027 부근) 및 이를 여는 버튼 제거.

- [ ] **Step 2: ArtistsPageClient — "URL로 아티스트 추가"만 제거**

- `/api/admin/artists/from-url` fetch 핸들러(:224 부근) 및 관련 state 제거.
- "URL로 아티스트 추가" 다이얼로그(:1058-1072 부근) 및 이를 여는 버튼 제거.
- **일반 "아티스트 추가" 수동 폼(:509/715)은 그대로 둔다.**

- [ ] **Step 3: 타입체크 + 린트**

Run: `npm run typecheck && npm run lint`
Expected: 통과. (미사용 import/state 남으면 에러 → 제거.)

- [ ] **Step 4: 커밋**

```bash
git add components/admin/EventsPageClient.tsx components/admin/ArtistsPageClient.tsx
git commit -m "chore: 이벤트/아티스트 StagePick URL 임포트 제거"
```

---

### Task 4: CrawlerPageClient — 수동 실행 패널 제거

**Files:**
- Modify: `components/admin/CrawlerPageClient.tsx`

**Interfaces:**
- Consumes: 없음. "실행 이력" 테이블 + "소스 관리" 탭(`CrawlerSourcesTab`)은 유지.

- [ ] **Step 1: "크롤러 실행" 수동 패널 제거**

- `handleRun` 핸들러(:107~, `/api/admin/crawler/run` fetch) 및 관련 state(`running`, 선택 소스/횟수 state) 제거.
- "크롤러 실행" 카드 전체(:179-262 부근: 소스 Select, 하드코딩 `<SelectItem value="stagepick">StagePick</SelectItem>`(:202), 횟수 Select, "실행" 버튼) 제거.
- 미사용이 되는 import 정리: `Select`/`SelectItem`/`SelectContent`/`SelectTrigger`/`SelectValue`(:20-26)가 다른 곳에서 안 쓰이면 제거(타입체크/린트가 잡음).
- "실행 이력" 탭의 테이블(:263~)과 "소스 관리" 탭(:351-353)은 유지. 탭 구조가 남은 컨텐츠와 맞는지 확인(탭이 하나만 남으면 `Tabs` 유지해도 무방).

- [ ] **Step 2: 타입체크 + 린트**

Run: `npm run typecheck && npm run lint`
Expected: 통과.

- [ ] **Step 3: 커밋**

```bash
git add components/admin/CrawlerPageClient.tsx
git commit -m "chore: 수동 크롤러 실행 패널(StagePick 전용) 제거"
```

---

### Task 5: 장식성 참조 정리

**Files:**
- Modify: `lib/ingestion/source-trust.ts`
- Modify: `components/admin/DashboardPageClient.tsx`
- Modify: `components/admin/TimetableUnmatchedPageClient.tsx`
- Modify: `lib/ingestion/event-auto-merge.ts`

**Interfaces:**
- Consumes: `trustOf()`는 미지 소스에 `DEFAULT_TRUST=50` 반환 → stagepick 항목 제거해도 무해.

- [ ] **Step 1: source-trust에서 stagepick 랭크 제거**

`lib/ingestion/source-trust.ts`의 `SOURCE_TRUST`(:11-23)에서 `stagepick: 60,` 줄 삭제.

- [ ] **Step 2: 라벨/주석 정리**

- `components/admin/DashboardPageClient.tsx:107` — `desc: "stagepick"` 항목 제거(또는 실제 소스로 교체). 주변 데이터 구조가 깨지지 않게 배열/객체에서 항목째 제거.
- `components/admin/TimetableUnmatchedPageClient.tsx:54` — 배지 라벨 `"자동(StagePick)"` → `"자동"`.
- `lib/ingestion/event-auto-merge.ts:510` — StagePick 예시 주석 제거/일반화.

- [ ] **Step 3: 타입체크 + 린트**

Run: `npm run typecheck && npm run lint`
Expected: 통과.

- [ ] **Step 4: 커밋**

```bash
git add lib/ingestion/source-trust.ts components/admin/DashboardPageClient.tsx components/admin/TimetableUnmatchedPageClient.tsx lib/ingestion/event-auto-merge.ts
git commit -m "chore: StagePick 라벨·트러스트 랭크·주석 정리"
```

---

### Task 6: crawler_sources에서 stagepick 행 제거 (마이그레이션)

**Files:**
- Create: `supabase/migrations/<YYYYMMDDHHMMSS>_remove_stagepick_source.sql`

**Interfaces:**
- Consumes: 없음.

- [ ] **Step 1: 타임스탬프 생성**

Run: `date +%Y%m%d%H%M%S`
이 값을 파일명 prefix로 사용.

- [ ] **Step 2: 마이그레이션 파일 작성**

`supabase/migrations/<ts>_remove_stagepick_source.sql`:
```sql
-- StagePick 완전 제거: crawler_sources 행 삭제 (자동 크롤·소스관리 탭에서 제외)
DELETE FROM crawler_sources WHERE name = 'stagepick';
```

- [ ] **Step 3: 적용 (Supabase에 반영)**

레포 관례대로 마이그레이션을 Supabase에 적용한다(프로젝트의 기존 적용 방법 사용 — 예: Supabase 대시보드 SQL 실행 또는 CLI). 적용 후 확인:
Run(임시): `crawler_sources`에 `name='stagepick'` 행이 0개인지 조회.
Expected: 0행.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/
git commit -m "chore: crawler_sources에서 stagepick 행 제거 (migration)"
```

---

### Task 7: 최종 검증

**Files:** 없음(검증만).

- [ ] **Step 1: 전체 타입체크 + 린트**

Run: `npm run typecheck && npm run lint`
Expected: 통과.

- [ ] **Step 2: StagePick 잔재 grep**

Run: `grep -rin "stagepick" app lib components supabase/migrations --include="*.ts" --include="*.tsx" --include="*.sql" | grep -v "_remove_stagepick_source"`
Expected: 0건. (남으면 해당 파일 처리 후 재확인. 과거 마이그레이션 히스토리 파일에 남은 참조는 불변이므로 예외 — 단 신규 코드/UI엔 0.)

- [ ] **Step 3: 페이지 수동 로드 확인**

`npm run dev` 후:
- `/admin/crawler` — 실행 이력·소스 관리 탭 로드, 수동 실행 패널 없음, stagepick 항목 없음.
- `/admin/events` — "URL로 공연 추가" 버튼 없음.
- `/admin/artists` — "URL로 아티스트 추가" 없음, 일반 "아티스트 추가" 동작.
- 이벤트 → 타임테이블 다이얼로그 — "이미지 분석하기" primary, StagePick URL칸/자동생성 버튼 없음, 부제 이미지 전용 문구.

- [ ] **Step 4: (선택) 이미지 파싱 실동작 확인**

Gemini 가용 시, 페스티벌 타임테이블 이미지 업로드 → "이미지 분석하기" → 행 파싱 → 커밋까지 확인. (Gemini 다운이면 스킵 — 이 플랜 범위 밖.)
