-- events.poster_checked_at: 표지(poster_url) 자동 보강 시도 워터마크
--
-- 배경: gemini-search 등으로 들어온 공연 중 표지가 없는 게 있다. interpark 예매 URL 이 있는
-- 경우 ticketimage CDN 패턴으로 포스터를 결정적으로 구성할 수 있다(검증 후 저장).
-- 한번 시도하면(못 찾아도) 이 컬럼에 기록해 재시도를 막는다. interpark URL 이 없는 건은
-- admin '표지 없음' 필터 + 포스터 업로더로 수동 처리한다.

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS poster_checked_at timestamptz;
