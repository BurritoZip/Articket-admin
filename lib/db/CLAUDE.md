# lib/db/ — DB 공통 유틸

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `pipeline-tracker.ts` | 파이프라인 단계 상태 추적 — `stepStart()`, `stepProgress()`, `stepDone()`, `stepFailed()`. 실행 이력 — `startPipelineRun()`, `finishPipelineRun()` |
| `status-sweeper.ts` | 이벤트 상태 bulk 업데이트 — `sweepEventStatuses()` (end_date 기준 ended/ongoing/on_sale/upcoming) |

## 두 종류의 추적 (역할 분리)

- **`pipeline_step_status`** — 실시간 대시보드용. 단계당 1행을 **덮어쓴다**(step_name PK). 대시보드가 1.5초 폴링. 항상 "지금 어느 단계인지"만 보여줌.
- **`pipeline_runs`** — 실행 이력용. 실행 1건당 1행을 **append**. `summary`(JSONB)에 단계별 결과(시도/성공/실패 카운트, geminiErrors 등)를 통째로 남긴다. `failed_steps`, `duration_ms`, `status`(done/partial/failed). "어제 뭐가 몇 건이었나", "언제부터 enrich 가 0건이었나", "부분 실패(100건 중 99건)"를 사후 조회. `runFullPipeline`(lib/pipeline/run-pipeline.ts)이 자동 기록.
