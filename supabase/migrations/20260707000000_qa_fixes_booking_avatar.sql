-- =====================================================
-- QA 보수: 예매 링크 / 예매완료 상태 / 아바타 업로드
-- iOS 이슈 1 (예매하기 버튼), 3 (예매 완료 CTA), 8 (프로필 이미지 업로드)
-- =====================================================

-- ── 이슈 1: 외부 예매 사이트 URL ────────────────────
-- iOS 공연 상세 '예매하기' 버튼이 여는 외부 예매처 URL.
-- iOS DTO: EventRow.bookingUrl ⇄ 컬럼 booking_url (convertFromSnakeCase)
ALTER TABLE events ADD COLUMN IF NOT EXISTS booking_url TEXT;
COMMENT ON COLUMN events.booking_url IS '외부 예매 사이트 URL (iOS 예매하기 버튼 대상)';

-- ── 이슈 3: 예매 완료 상태 ──────────────────────────
-- user_bookings 에 status 컬럼 추가.
-- iOS 는 status 로 active/cancelled/completed 를 구분한다:
--   - active/completed → 예매된 공연 (마이페이지·타임테이블 노출)
--   - completed        → 사용자가 상세에서 '예매 완료'로 직접 표시한 공연
-- 기존 iOS 쿼리(status=eq.active / eq.cancelled)도 이 컬럼에 의존한다.
ALTER TABLE user_bookings
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
  CHECK (status IN ('active', 'upcoming', 'cancelled', 'completed'));
COMMENT ON COLUMN user_bookings.status IS '예매 상태 (active/upcoming/cancelled/completed)';

-- RLS 주: user_bookings 의 "owner_only" 정책은 FOR ALL + USING(auth.uid()=user_id)
-- 이며 WITH CHECK 생략 시 USING 식이 INSERT 검사로도 적용된다.
-- 따라서 로그인 유저의 본인 행 INSERT(예매 완료 표시)는 이미 허용된다 — 추가 정책 불필요.

-- ── 이슈 8: 아바타 스토리지 버킷 + 유저 RLS ──────────
-- 프로필 이미지 업로드용 public 버킷. 오브젝트 키 규약: {uid}/avatar.jpg
-- (첫 폴더 세그먼트 = 유저 uid → 본인만 쓰기 허용)
INSERT INTO storage.buckets (id, name, public) VALUES
  ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 공개 읽기 (아바타는 프로필에 표시되므로 공개)
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

-- 본인 폴더에만 업로드
DROP POLICY IF EXISTS "avatars_user_insert" ON storage.objects;
CREATE POLICY "avatars_user_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 본인 파일 덮어쓰기(업서트)
DROP POLICY IF EXISTS "avatars_user_update" ON storage.objects;
CREATE POLICY "avatars_user_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 본인 파일 삭제
DROP POLICY IF EXISTS "avatars_user_delete" ON storage.objects;
CREATE POLICY "avatars_user_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
