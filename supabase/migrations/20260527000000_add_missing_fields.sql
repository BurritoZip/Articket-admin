-- =====================================================
-- 기능명세 누락 항목 보완
-- - events.ticket_close_date : 티켓팅 종료일
-- - events.organizer         : 공연 주최/주관사
-- - crawler_sources          : yes24, interpark, melon, yanolja, festivallife 등록
-- =====================================================

-- 1. events 테이블 컬럼 추가
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_close_date TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer TEXT;

COMMENT ON COLUMN events.ticket_close_date IS '티켓팅 마감일시 (KST 기준 TIMESTAMPTZ)';
COMMENT ON COLUMN events.organizer IS '공연 주최/주관사 (복수일 경우 쉼표 구분)';

-- 2. crawler_sources 에 누락 소스 등록
INSERT INTO crawler_sources (name, display_name, base_url, enabled, config)
VALUES
  ('yes24',        'Yes24',          'https://ticket.yes24.com',         TRUE, '{"rateLimit": 800}'),
  ('interpark',    'Interpark',      'https://tickets.interpark.com',    TRUE, '{"rateLimit": 800}'),
  ('melon',        'Melon Ticket',   'https://ticket.melon.com',         TRUE, '{"rateLimit": 800}'),
  ('yanolja',      '야놀자',         'https://nol.yanolja.com',          TRUE, '{"rateLimit": 1000}'),
  ('festivallife', '페스티벌라이프', 'https://www.festivallife.kr',      TRUE, '{"rateLimit": 1000}')
ON CONFLICT (name) DO NOTHING;
