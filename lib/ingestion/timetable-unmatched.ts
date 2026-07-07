import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type TimetableSource = "image" | "text" | "auto" | "manual";

export type UnmatchedArtistLog = {
  eventId: string;
  eventTitle?: string | null;
  artistName: string;
  stageName?: string | null;
  dayNumber?: number | null;
  source: TimetableSource;
};

/**
 * 타임테이블 임포트 중 기존 아티스트 리스트에 매칭되지 않은 이름을 로그로 남긴다.
 * (event_id, lower(artist_name)) 유니크 → 재임포트 시 중복 없이 갱신. 실패는 무시(임포트 흐름 유지).
 */
export async function logUnmatchedTimetableArtist(
  log: UnmatchedArtistLog,
): Promise<void> {
  if (!log.artistName?.trim()) return;
  const db = createServiceRoleClient();
  const { error } = await db.from("timetable_unmatched_artists").upsert(
    {
      event_id: log.eventId,
      event_title: log.eventTitle ?? null,
      artist_name: log.artistName.trim(),
      stage_name: log.stageName?.trim() || null,
      day_number: log.dayNumber ?? null,
      source: log.source,
      is_resolved: false,
    },
    { onConflict: "event_id,artist_name", ignoreDuplicates: false },
  );
  if (error) {
    console.warn(
      `[TimetableUnmatched] 로그 실패 "${log.artistName}": ${error.message}`,
    );
  }
}
