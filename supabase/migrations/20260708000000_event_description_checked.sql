-- events.description_checked_at: 설명(description) 보강 시도 워터마크
--
-- 배경: melon/interpark/yes24 는 목록만 긁고 상세는 CSR/봇차단이라 description 이 비어 들어온다.
-- enrich 단계가 Google 검색 그라운딩으로 공연 설명을 채운다. 한번 시도하면(못 찾아도) 이 컬럼에
-- 기록해 재호출을 막는다(토큰 절약) — 장르/연령 보강과 동일한 1회성 워터마크 패턴.

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS description_checked_at timestamptz;
