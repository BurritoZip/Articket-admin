-- 파이프라인 실행 이력
--
-- 문제: pipeline_step_status 는 step_name 이 PRIMARY KEY 라 단계당 1행을 매 실행 덮어쓴다.
--   → "어제 몇 건 처리했나", "성공률 추세가 어떤가", "언제부터 enrich 가 0건이었나" 를 조회할 수 없다.
--   또 단계 함수가 부분 실패(100건 중 99건 실패)해도 status 는 done 이라, 사후에 알 방법이 없었다.
-- 조치: 실행 1건당 1행을 append 하는 이력 테이블. 단계별 결과(시도/성공/실패 카운트 포함)를
--   summary JSONB 에 통째로 남긴다. pipeline_step_status(실시간 대시보드)는 그대로 둔다.

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger      TEXT NOT NULL,                -- local-cron | pipeline | cron
  status       TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running', 'done', 'partial', 'failed')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  duration_ms  INTEGER,
  step_count   INTEGER,                      -- 완료한 단계 수
  failed_steps TEXT[] NOT NULL DEFAULT '{}', -- 실패(throw)한 단계 이름
  summary      JSONB,                        -- 단계별 결과 전체(step -> result)
  error        TEXT                          -- 파이프라인 전체 치명 오류(있으면)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at
  ON pipeline_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status
  ON pipeline_runs (status);

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
