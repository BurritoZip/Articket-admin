-- ============================================================
-- Event Artists — many-to-many lineup relations
-- ============================================================

CREATE TABLE IF NOT EXISTS event_artists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  artist_id     UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  artist_name   TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'lineup',
  display_order INT NOT NULL DEFAULT 0,
  source_name   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_event_artists_event
  ON event_artists(event_id, display_order);
CREATE INDEX IF NOT EXISTS idx_event_artists_artist
  ON event_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_event_artists_source
  ON event_artists(source_name);
