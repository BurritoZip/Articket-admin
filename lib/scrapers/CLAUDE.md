# lib/scrapers/ — TypeScript 스크래퍼

## 현재 구현

**StagePick** (`stagepick/`)만 TypeScript로 구현됨.
나머지 사이트(yes24, melon, interpark, yanolja, festivallife)는 `scripts/scraper/` Python으로 운영.

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `stagepick/scraper.ts` | StagePick 크롤 진입점 — `runStagepickScraper(jobId, opts)` |
| `stagepick/parser.ts` | StagePick HTML 파싱 |
| `base/adapter.ts` | 스크래퍼 공통 인터페이스 |

## 주의

StagePick TypeScript 크론은 현재 비활성 (로컬 launchd 중지됨).
Python 크론(6시/18시)이 보조 사이트 전담.
