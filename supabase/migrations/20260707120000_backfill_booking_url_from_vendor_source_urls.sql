-- booking_url 백필: source_urls 안의 실제 티켓 벤더 URL을 booking_url 로 채운다.
--
-- 배경: 크롤링된 이벤트 대부분(1554건)의 booking_url 이 NULL 이라 iOS 공연 상세의
-- '예매하기' 버튼이 눌러도 열 곳이 없었다. source_urls(jsonb 배열; 문자열/오브젝트 혼재)에
-- 실제 예매 가능한 벤더 링크가 들어있어 이를 booking_url 로 승격한다.
--
-- 포함(실제 예매 사이트): interpark, yes24, melon, yanolja(nol), klook
-- 제외: stagepick.co.kr, festivallife.kr (예매 사이트 아님 — 공연 정보/목록 페이지),
--       *.internal (gemini-search.internal 등 내부/무효 URL)
-- vendor URL 이 없는 이벤트는 그대로 NULL 유지 → iOS 버튼은 검정 활성이되 탭 시 무동작(guard).
--
-- 우선순위: interpark > yes24 > melon > yanolja > klook, 동일 벤더면 source_urls 등장 순서.
-- 이미 booking_url 이 있는 행은 건드리지 않는다(idempotent).

UPDATE public.events AS e
SET booking_url = sub.url
FROM (
    SELECT
        ev.id,
        (
            SELECT u.url
            FROM (
                SELECT
                    CASE jsonb_typeof(elem)
                        WHEN 'string' THEN elem #>> '{}'
                        ELSE elem ->> 'url'
                    END AS url,
                    ord
                FROM jsonb_array_elements(ev.source_urls) WITH ORDINALITY AS t(elem, ord)
            ) AS u
            WHERE u.url ~* '(tickets?\.interpark\.com|ticket\.yes24\.com|ticket\.melon\.com|nol\.yanolja\.com|www\.klook\.com)'
            ORDER BY
                CASE
                    WHEN u.url ~* 'interpark\.com'   THEN 1
                    WHEN u.url ~* 'ticket\.yes24'    THEN 2
                    WHEN u.url ~* 'ticket\.melon'    THEN 3
                    WHEN u.url ~* 'nol\.yanolja'     THEN 4
                    WHEN u.url ~* 'klook\.com'       THEN 5
                    ELSE 6
                END,
                u.ord
            LIMIT 1
        ) AS url
    FROM public.events AS ev
    WHERE ev.booking_url IS NULL
      AND ev.source_urls IS NOT NULL
) AS sub
WHERE e.id = sub.id
  AND sub.url IS NOT NULL;
