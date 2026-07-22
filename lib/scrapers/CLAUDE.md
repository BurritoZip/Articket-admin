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
- **enabled=true**: `yes24`, `interpark`, `festivallife`, `yanolja`, `melon`
- **enabled=false**: `stagepick`, `gemini-search`
  - `gemini-search` — LLM 발견 소스. ROI 최악(포스터·예매링크 없는 결손 레코드 양산, 고유 기여 대부분이 예매처에 이미 있는 대형 공연의 표기만 다른 중복)이라 비활성. 대형 공연은 예매처 크롤이, 인디·무료 공연은 festivallife 가 커버.
  - `stagepick` — 비활성 상태.
  - `melon` — 2026-07 사이트 개편으로 prodList.json API 파라미터가 바뀌어 죽었던 것을 재작성해 복구(sortType/filterCode + 세션 쿠키). 응답의 saleTypeJson 에서 예매 오픈일도 파싱(그라운딩 절약).

각 소스 `trust_score`(신뢰도)로 upsert 병합 우선순위 결정: 예매처 70 / stagepick 60 / festivallife 55 / gemini-search 20. enrich(Gemini 보강)는 90.

## 파이프라인 진입점

8단계 로직은 `lib/pipeline/run-pipeline.ts` `runFullPipeline` 한 곳에만 있다. 세 진입점은 얇은 래퍼:
- `scripts/pipeline/run.ts` — 로컬 cron (npx tsx)
- `app/api/admin/pipeline/run/route.ts` — 수동 트리거 UI
- `app/api/admin/crawler/cron/route.ts` — curl/launchd cron

`runFullPipeline` 이 enabled=true 소스만 크롤한다(SCRAPER_MAP 에 있어도 DB 에서 off 면 스킵).

## 스크래퍼 추가 방법

1. `lib/scrapers/<name>/scraper.ts` 작성 — `run<Name>Scraper(jobId, opts)` export
2. 세 진입점의 `SCRAPER_MAP`에 `"<name>": (id) => run<Name>Scraper(id, opts)` 추가
3. DB: `crawler_sources`에 `INSERT` (migration 또는 Supabase 대시보드)
