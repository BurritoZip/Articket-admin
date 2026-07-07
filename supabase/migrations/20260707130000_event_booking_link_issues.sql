-- event_booking_link_issues: 예매 링크 미연결 이슈 로그
--
-- 배경: booking_url 이 없는 공연에서 iOS 사용자가 '예매하기'를 탭하면 열 곳이 없다.
-- 이제 iOS 는 안내 토스트를 띄우고 이 테이블에 이슈를 기록한다. Admin 콘솔이 이를 조회해
-- 어떤 공연의 예매 링크를 우선 채워야 하는지 파악한다.

CREATE TABLE IF NOT EXISTS public.event_booking_link_issues (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id     uuid REFERENCES public.events(id) ON DELETE CASCADE,
    event_title  text,
    reason       text NOT NULL DEFAULT 'missing_booking_url',
    platform     text NOT NULL DEFAULT 'ios',
    app_user_id  uuid,          -- 로그인 사용자면 auth uid, 비로그인이면 NULL
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_link_issues_created
    ON public.event_booking_link_issues (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_link_issues_event
    ON public.event_booking_link_issues (event_id);

ALTER TABLE public.event_booking_link_issues ENABLE ROW LEVEL SECURITY;

-- 앱(anon/authenticated)은 이슈를 남길 수만 있다. 조회는 Admin(service role, RLS 우회) 전용.
CREATE POLICY "booking_issue_insert_any" ON public.event_booking_link_issues
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);
