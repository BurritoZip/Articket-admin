-- ============================================================
-- Articket — Supabase RLS 정책
-- 사용법: Supabase 대시보드 → SQL Editor → 아래 SQL 실행
-- 실행 후 SupabaseConfig.swift의 anonKey를 anon public 키로 교체
-- ============================================================

-- 1. RLS 활성화
ALTER TABLE events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues  ENABLE ROW LEVEL SECURITY;
ALTER TABLE artists ENABLE ROW LEVEL SECURITY;

-- 2. anon(비로그인) 사용자도 공연 데이터 조회 가능
CREATE POLICY "events_public_read"
    ON events FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "venues_public_read"
    ON venues FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "artists_public_read"
    ON artists FOR SELECT
    TO anon, authenticated
    USING (true);

-- 3. 인증된 사용자 본인 데이터만 접근 가능
-- (user_profiles, user_bookings, user_artist_followings)
ALTER TABLE user_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_artist_followings  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles_own"
    ON user_profiles FOR ALL
    TO authenticated
    USING (auth.uid() = id);

CREATE POLICY "user_bookings_own"
    ON user_bookings FOR ALL
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "user_followings_own"
    ON user_artist_followings FOR ALL
    TO authenticated
    USING (auth.uid() = user_id);
