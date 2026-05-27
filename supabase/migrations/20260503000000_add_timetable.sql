-- =====================================================
-- Timetable support
-- =====================================================

-- 공연별 타임테이블 존재 여부 플래그
ALTER TABLE events ADD COLUMN IF NOT EXISTS has_timetable BOOLEAN DEFAULT false;

-- 공연 타임테이블 출연 정보
CREATE TABLE IF NOT EXISTS timetable_performances (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  artist_id    UUID        REFERENCES artists(id) ON DELETE SET NULL,
  day_number   INT         NOT NULL,          -- 공연 N일차 (1-based)
  date_string  TEXT        NOT NULL,          -- "2025.08.01" 형식
  start_time   TEXT        NOT NULL,          -- "14:00" 형식
  end_time     TEXT        NOT NULL,          -- "15:00" 형식
  artist_name  TEXT        NOT NULL,
  stage_name   TEXT        NOT NULL,
  genre        TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 공연/날짜/시간 순 조회 최적화
CREATE INDEX IF NOT EXISTS idx_timetable_event_day_time
  ON timetable_performances (event_id, day_number, start_time);

-- RLS
ALTER TABLE timetable_performances ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'timetable_performances'
      AND policyname = 'timetable_read_all'
  ) THEN
    CREATE POLICY "timetable_read_all"
      ON timetable_performances FOR SELECT USING (true);
  END IF;
END $$;
