import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { matchExistingArtist } from "@/lib/ingestion/artist-matcher";
import { logUnmatchedTimetableArtist } from "@/lib/ingestion/timetable-unmatched";
import type { ParsedPerformance } from "../from-image/route";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    event_id: string;
    replaceExisting?: boolean;
    performances: ParsedPerformance[];
  };

  if (!body.event_id || !Array.isArray(body.performances)) {
    return NextResponse.json(
      { error: "missing_required_fields" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  // 미매칭 로그에 이벤트 제목 붙이기용
  const { data: ev } = await supabase
    .from("events")
    .select("title")
    .eq("id", body.event_id)
    .maybeSingle();
  const eventTitle = (ev as { title: string | null } | null)?.title ?? null;

  if (body.replaceExisting) {
    await supabase
      .from("timetable_performances")
      .delete()
      .eq("event_id", body.event_id);
  }

  let inserted = 0;
  const errors: string[] = [];
  const unmatched: string[] = [];

  for (const perf of body.performances) {
    if (!perf.artist_name?.trim()) continue;
    const artistName = perf.artist_name.trim();

    // 기존 아티스트에 연결만 — 없으면 신규 생성 대신 로그로 분리
    const artistId = await matchExistingArtist(artistName);
    if (!artistId) {
      unmatched.push(artistName);
      await logUnmatchedTimetableArtist({
        eventId: body.event_id,
        eventTitle,
        artistName,
        stageName: perf.stage_name?.trim() ?? null,
        dayNumber: perf.day_number ?? null,
        source: "image",
      });
    }

    const { error } = await supabase.from("timetable_performances").insert({
      event_id: body.event_id,
      artist_id: artistId,
      artist_name: artistName,
      stage_name: perf.stage_name?.trim() ?? "",
      start_time: perf.start_time?.trim() ?? "",
      end_time: perf.end_time?.trim() ?? "",
      day_number: perf.day_number ?? 1,
      date_string: perf.date_string?.trim() ?? "",
      genre: "",
    });

    if (error) {
      errors.push(`${artistName}: ${error.message}`);
    } else {
      inserted++;
    }
  }

  if (inserted > 0) {
    await supabase
      .from("events")
      .update({ has_timetable: true })
      .eq("id", body.event_id);
  }

  return NextResponse.json({
    ok: true,
    inserted,
    errors,
    unmatched: Array.from(new Set(unmatched)),
  });
}
