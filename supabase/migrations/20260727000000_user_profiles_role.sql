-- user_profiles.role — 관리자 권한 플래그. requireAdmin() 이 role='admin' 를 확인한다.
-- 실운영 DB 엔 이미 존재하지만(과거 수동 추가) 마이그레이션 저장소엔 기록이 없어 스키마
-- 드리프트 상태였다. 마이그레이션이 source of truth 이므로 여기 기록한다.
-- IF NOT EXISTS 라 라이브 DB 엔 무변경(이미 컬럼 존재), 신규 환경에만 컬럼을 생성한다.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
