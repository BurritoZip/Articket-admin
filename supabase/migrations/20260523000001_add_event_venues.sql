-- event_venues: 공연-공연장 다대다 관계 테이블
CREATE TABLE IF NOT EXISTS event_venues (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  venue_id      UUID NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  display_order INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_event_venues_event ON event_venues(event_id, display_order);
CREATE INDEX IF NOT EXISTS idx_event_venues_venue ON event_venues(venue_id);
