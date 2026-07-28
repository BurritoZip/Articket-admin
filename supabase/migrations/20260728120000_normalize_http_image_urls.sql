-- 이미지 URL http:// 정규화 (iOS ATS -1022 차단 방지)
--
-- 배경: iOS는 App Transport Security로 http:// 이미지 요청을 차단(-1022)한다.
-- 일부 avatar_url/poster_url이 http://로 저장돼 앱에서 이미지가 안 뜨고 회색으로만 남았다.
-- (curl은 ATS를 안 타 200이라 서버 문제로는 안 보였음)
--
-- 조치:
--  1) 죽은 nocache 기본 OG 이미지(실제 아바타 아님 + 호스트가 http·https 모두 다운) → NULL
--     → 앱이 아티스트 이니셜 폴백을 표시(깨진 generic 이미지 대신).
--  2) 그 외 남은 http:// 이미지 URL은 https로 승격(CDN들이 https 지원).
--
-- 모두 idempotent — 재실행해도 안전(이미 정규화됐으면 no-op).

-- 1) 죽은 nocache og-image 아바타 제거
UPDATE artists
SET avatar_url = NULL
WHERE avatar_url LIKE 'http://nocache.stagepick.co.kr/%';

-- 2) 나머지 http:// 이미지 URL → https 승격
UPDATE artists
SET avatar_url = 'https://' || substring(avatar_url FROM 8)
WHERE avatar_url LIKE 'http://%';

UPDATE events
SET poster_url = 'https://' || substring(poster_url FROM 8)
WHERE poster_url LIKE 'http://%';
