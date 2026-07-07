-- timetable_unmatched_artists: 타임테이블 임포트 시 기존 아티스트 리스트에 매칭 안 된 이름 로그
--
-- 배경: 지금까지 타임테이블(캡쳐본/텍스트/StagePick 자동) 임포트는 미매칭 아티스트를 곧바로
-- 신규 생성해버려, 오탈자/표기 흔들림이 그대로 새 아티스트로 굳어졌다.
-- 이제 임포트는 "기존 아티스트에 연결만" 하고(matchExistingArtist), 리스트에 없는 사람은
-- 여기로 로그를 빼둔다. 운영자가 검토 후 별칭 추가/신규 생성/무시를 판단한다.
-- timetable_performances 행 자체는 그대로 저장되므로(artist_id 만 NULL) 타임테이블은 완전하다.

CREATE TABLE IF NOT EXISTS public.timetable_unmatched_artists (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id     uuid REFERENCES public.events(id) ON DELETE CASCADE,
    event_title  text,
    artist_name  text NOT NULL,
    stage_name   text,
    day_number   integer,
    source       text NOT NULL DEFAULT 'manual',  -- image | text | auto | manual
    is_resolved  boolean NOT NULL DEFAULT false,   -- 운영자가 검토/처리 완료 표시
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tt_unmatched_created
    ON public.timetable_unmatched_artists (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tt_unmatched_event
    ON public.timetable_unmatched_artists (event_id);
CREATE INDEX IF NOT EXISTS idx_tt_unmatched_unresolved
    ON public.timetable_unmatched_artists (is_resolved, created_at DESC);

-- 같은 이벤트에 같은 이름이 반복 로깅되지 않도록 (재임포트 시 upsert 대상)
-- PostgREST onConflict 는 컬럼명만 지원 → 표현식 대신 평문 컬럼 유니크.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tt_unmatched_event_name
    ON public.timetable_unmatched_artists (event_id, artist_name);

-- 서버(service role) 전용 — 임포트 로직이 쓰고, Admin 이 읽는다. anon 접근 없음.
ALTER TABLE public.timetable_unmatched_artists ENABLE ROW LEVEL SECURITY;
