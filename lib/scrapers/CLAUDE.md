# lib/scrapers/ — TypeScript 스크래퍼

## 현재 구현

| 디렉토리 | 소스 | 방식 | 진입점 |
|---|---|---|---|
| `yes24/` | Yes24 티켓 | AJAX HTML (`GenreList_Data.aspx`) | `runYes24Scraper(jobId, opts)` |
| `melon/` | 멜론 티켓 | JSON API (`prodList.json`) | `runMelonScraper(jobId, opts)` |
| `interpark/` | 인터파크 티켓 | HTML (Next.js CSS modules) | `runInterparkScraper(jobId, opts)` |
| `festivallife/` | 페스티벌라이프 | HTML 페이지네이션 + 상세 | `runFestivallifeScraper(jobId, opts)` |
| `yanolja/` | 야놀자 티켓 | HTML SSR + 상세 | `runYanoljaScraper(jobId, opts)` |
| `gemini-search/` | Gemini 그라운딩 검색 | Gemini Google Search grounding | `runGeminiSearchScraper(jobId, opts)` |
| `stagepick/` | StagePick (비활성) | JSON API | `runStagepickScraper(jobId, opts)` |
| `base/` | 공통 인터페이스 | — | `ScraperAdapter` |

## 활성화 상태

`crawler_sources` 테이블 `enabled` 컬럼으로 제어.
- `yes24`, `melon`, `interpark`, `festivallife`, `yanolja`, `gemini-search` → **enabled=true**
- `stagepick` → **enabled=false**

## 파이프라인 진입점 (3곳 모두 동일 SCRAPER_MAP)

- `scripts/pipeline/run.ts` — 로컬 cron (npx tsx)
- `app/api/admin/pipeline/run/route.ts` — 수동 트리거 UI
- `app/api/admin/crawler/cron/route.ts` — curl/launchd cron

## 스크래퍼 추가 방법

1. `lib/scrapers/<name>/scraper.ts` 작성 — `run<Name>Scraper(jobId, opts)` export
2. 세 진입점의 `SCRAPER_MAP`에 `"<name>": (id) => run<Name>Scraper(id, opts)` 추가
3. DB: `crawler_sources`에 `INSERT` (migration 또는 Supabase 대시보드)
