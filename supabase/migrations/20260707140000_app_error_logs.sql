-- app_error_logs: 클라이언트(iOS 앱 등) 런타임 에러/크래시 로그
--
-- 배경: 지금까지 서버 파이프라인 에러(ingestion_errors)만 admin 에서 볼 수 있었고,
-- 앱에서 발생한 런타임 에러/크래시/디코딩 실패는 어디에도 남지 않아 운영자가 알 수 없었다.
-- 이제 앱이 잡히지 않은 예외(uncaught exception)와 명시적으로 리포트한 오류를 이 테이블에 기록하고,
-- Admin 콘솔(/admin/error-logs)이 이를 조회한다. booking-link 이슈와 동일한 anon-insert 패턴.

CREATE TABLE IF NOT EXISTS public.app_error_logs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform      text NOT NULL DEFAULT 'ios',           -- ios | android | web
    -- crash: 잡히지 않은 예외/시그널, network: 통신, decoding: 디코딩 실패,
    -- http: 4xx/5xx, runtime: 그 외 앱 내부 오류
    error_type    text NOT NULL DEFAULT 'runtime',
    message       text NOT NULL,                         -- 에러 요약(1줄)
    domain        text,                                  -- 발생 위치/기능 (예: ConcertDetail, EventRepository.fetch)
    stack_trace   text,                                  -- 스택 트레이스 전문(있으면)
    context       jsonb,                                 -- 추가 진단 정보 (자유 형식)
    app_version   text,                                  -- 앱 버전 (예: 1.4.0(120))
    os_version    text,                                  -- OS 버전 (예: iOS 18.2)
    device_model  text,                                  -- 기기 모델 (예: iPhone16,2)
    app_user_id   uuid,                                  -- 로그인 사용자면 auth uid, 비로그인이면 NULL
    is_resolved   boolean NOT NULL DEFAULT false,        -- 운영자가 확인/처리 완료 표시
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_error_logs_created
    ON public.app_error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_error_logs_type
    ON public.app_error_logs (error_type);
CREATE INDEX IF NOT EXISTS idx_app_error_logs_unresolved
    ON public.app_error_logs (is_resolved, created_at DESC);

ALTER TABLE public.app_error_logs ENABLE ROW LEVEL SECURITY;

-- 앱(anon/authenticated)은 에러를 남길 수만 있다. 조회/수정은 Admin(service role, RLS 우회) 전용.
CREATE POLICY "app_error_log_insert_any" ON public.app_error_logs
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);
