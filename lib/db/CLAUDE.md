# lib/db/ — DB 공통 유틸

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `pipeline-tracker.ts` | 파이프라인 단계 상태 추적 — `stepStart()`, `stepProgress()`, `stepDone()`, `stepFailed()` |
| `status-sweeper.ts` | 이벤트 상태 bulk 업데이트 — `sweepEventStatuses()` (end_date 기준 ended/ongoing/on_sale/upcoming) |

## pipeline_step_status 테이블

각 단계(crawl/sweep/fix/delete/enrich/merge)의 실행 상태를 저장.
대시보드 파이프라인 시각화가 이 테이블을 1.5초마다 폴링.
