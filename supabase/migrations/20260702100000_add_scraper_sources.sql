-- 새 스크래퍼 소스 등록 (stagepick은 비활성 유지)
INSERT INTO crawler_sources (name, display_name, base_url, enabled, config)
VALUES
  ('yes24',         'Yes24 티켓',      'https://ticket.yes24.com',                         true, '{}'),
  ('melon',         '멜론 티켓',        'https://ticket.melon.com',                         true, '{}'),
  ('interpark',     '인터파크 티켓',    'https://tickets.interpark.com',                    true, '{}'),
  ('festivallife',  '페스티벌라이프',   'https://www.festivallife.kr',                      true, '{}'),
  ('yanolja',       '야놀자 티켓',      'https://nol.yanolja.com',                          true, '{}'),
  ('gemini-search', 'Gemini 검색',     'https://gemini-search.internal',                   true, '{}')
ON CONFLICT (name) DO UPDATE
  SET enabled      = EXCLUDED.enabled,
      display_name = EXCLUDED.display_name,
      base_url     = EXCLUDED.base_url,
      config       = EXCLUDED.config;

-- stagepick 비활성 확인
UPDATE crawler_sources SET enabled = false WHERE name = 'stagepick';
