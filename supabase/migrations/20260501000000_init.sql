-- =====================================================
-- Articket Database Schema
-- Supabase / PostgreSQL 15+
-- =====================================================

-- =====================================================
-- CORE TABLES
-- =====================================================

-- 공연장
CREATE TABLE venues (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  address       TEXT        NOT NULL,
  phone_number  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 아티스트
CREATE TABLE artists (
  id                   UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT  NOT NULL,
  avatar_url           TEXT,           -- storage: artist-avatars/{id}.jpg
  followers_count      INT   DEFAULT 0,
  upcoming_event_count INT   DEFAULT 0,
  occupation           TEXT,
  birth_date           TEXT,
  birth_place          TEXT,
  related              TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- 공연 이벤트
-- poster_url → Supabase Storage public URL (concert-posters/{id}.jpg)
CREATE TABLE events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT        NOT NULL,
  artist_id        UUID        REFERENCES artists(id) ON DELETE SET NULL,
  venue_id         UUID        REFERENCES venues(id)  ON DELETE SET NULL,
  poster_url       TEXT,
  start_date       TIMESTAMPTZ NOT NULL,
  end_date         TIMESTAMPTZ NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'upcoming'
                               CHECK (status IN ('on_sale', 'upcoming', 'ended')),
  genre            TEXT,
  duration         TEXT,
  age_restriction  TEXT,
  ticket_open_date TIMESTAMPTZ,
  ticket_provider  TEXT,
  notice_text      TEXT,
  is_banner        BOOLEAN     DEFAULT false,  -- 홈 상단 배너 노출 여부
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- 공연 후기
CREATE TABLE concert_reviews (
  id         UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID  NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID  REFERENCES auth.users(id) ON DELETE SET NULL,
  username   TEXT  NOT NULL,   -- 마스킹 표시 이름 (ex: "bogyu****")
  star_count INT   NOT NULL CHECK (star_count BETWEEN 1 AND 5),
  title      TEXT  NOT NULL,
  content    TEXT  NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- ARTIST DETAIL TABLES
-- =====================================================

-- 아티스트 과거 공연
CREATE TABLE artist_past_concerts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id  UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  poster_url TEXT,              -- storage: concert-posters/{id}.jpg
  start_date TIMESTAMPTZ,
  end_date   TIMESTAMPTZ,
  venue_name TEXT,
  sort_order INT  DEFAULT 0
);

-- 아티스트 뮤직비디오
CREATE TABLE artist_music_videos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id     UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  thumbnail_url TEXT,           -- storage: mv-thumbnails/{id}.jpg
  view_count    TEXT,
  like_count    TEXT,
  uploaded_at   TIMESTAMPTZ,
  sort_order    INT  DEFAULT 0
);

-- 아티스트 앨범
CREATE TABLE artist_albums (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id     UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  cover_url     TEXT,           -- storage: album-covers/{id}.jpg
  released_year TEXT,
  sort_order    INT  DEFAULT 0
);

-- =====================================================
-- USER TABLES
-- =====================================================

-- 유저 프로필 (auth.users 1:1 확장)
CREATE TABLE user_profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL,
  last_visit_date TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 신규 유저 가입 시 user_profiles 자동 생성
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO user_profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 예매 현황
CREATE TABLE user_bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id      UUID NOT NULL REFERENCES events(id)     ON DELETE CASCADE,
  seat          TEXT,
  delivery_type TEXT CHECK (delivery_type IN ('delivery', 'onsite')),
  booked_at     TIMESTAMPTZ DEFAULT now()
);

-- 아티스트 팔로우
CREATE TABLE user_artist_followings (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artist_id   UUID NOT NULL REFERENCES artists(id)    ON DELETE CASCADE,
  followed_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, artist_id)
);

-- 관심 공연
CREATE TABLE user_interested_events (
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id)     ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_events_artist_id   ON events(artist_id);
CREATE INDEX idx_events_start_date  ON events(start_date);
CREATE INDEX idx_events_status      ON events(status);
CREATE INDEX idx_events_is_banner   ON events(is_banner) WHERE is_banner = true;

CREATE INDEX idx_reviews_event_id         ON concert_reviews(event_id);
CREATE INDEX idx_bookings_user_id         ON user_bookings(user_id);
CREATE INDEX idx_followings_user_id       ON user_artist_followings(user_id);
CREATE INDEX idx_interested_user_id       ON user_interested_events(user_id);
CREATE INDEX idx_past_concerts_artist_id  ON artist_past_concerts(artist_id, sort_order);
CREATE INDEX idx_music_videos_artist_id   ON artist_music_videos(artist_id, sort_order);
CREATE INDEX idx_albums_artist_id         ON artist_albums(artist_id, sort_order);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

-- 공개 콘텐츠 — 누구나 읽기 가능
ALTER TABLE venues                ENABLE ROW LEVEL SECURITY;
ALTER TABLE artists               ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE concert_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_past_concerts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_music_videos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_albums         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON venues               FOR SELECT USING (true);
CREATE POLICY "public_read" ON artists              FOR SELECT USING (true);
CREATE POLICY "public_read" ON events               FOR SELECT USING (true);
CREATE POLICY "public_read" ON concert_reviews      FOR SELECT USING (true);
CREATE POLICY "public_read" ON artist_past_concerts FOR SELECT USING (true);
CREATE POLICY "public_read" ON artist_music_videos  FOR SELECT USING (true);
CREATE POLICY "public_read" ON artist_albums        FOR SELECT USING (true);

-- 콘텐츠 관리 — service_role (관리자 SDK) 만 write
CREATE POLICY "admin_write" ON venues               FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "admin_write" ON artists              FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "admin_write" ON events               FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "admin_write" ON artist_past_concerts FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "admin_write" ON artist_music_videos  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "admin_write" ON artist_albums        FOR ALL USING (auth.role() = 'service_role');

-- 후기 — 인증 유저만 작성, 본인만 삭제
CREATE POLICY "auth_insert" ON concert_reviews
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "owner_delete" ON concert_reviews
  FOR DELETE USING (auth.uid() = user_id);

-- 유저 전용 테이블 — 본인 데이터만 접근
ALTER TABLE user_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bookings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_artist_followings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_interested_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_only" ON user_profiles          USING (auth.uid() = id);
CREATE POLICY "owner_only" ON user_bookings          USING (auth.uid() = user_id);
CREATE POLICY "owner_only" ON user_artist_followings USING (auth.uid() = user_id);
CREATE POLICY "owner_only" ON user_interested_events USING (auth.uid() = user_id);

-- =====================================================
-- STORAGE BUCKETS
-- Supabase Dashboard > Storage에서 생성하거나 아래 SQL 직접 실행
--
-- 버킷 경로 규칙:
--   concert-posters/{event_id}.jpg
--   artist-avatars/{artist_id}.jpg
--   album-covers/{album_id}.jpg
--   mv-thumbnails/{mv_id}.jpg
-- =====================================================

INSERT INTO storage.buckets (id, name, public) VALUES
  ('concert-posters', 'concert-posters', true),
  ('artist-avatars',  'artist-avatars',  true),
  ('album-covers',    'album-covers',    true),
  ('mv-thumbnails',   'mv-thumbnails',   true)
ON CONFLICT DO NOTHING;

-- Storage RLS — 공개 읽기
CREATE POLICY "public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id IN ('concert-posters', 'artist-avatars', 'album-covers', 'mv-thumbnails'));

-- Storage RLS — service_role 만 업로드/삭제
CREATE POLICY "admin_upload" ON storage.objects
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "admin_delete" ON storage.objects
  FOR DELETE
  USING (auth.role() = 'service_role');
