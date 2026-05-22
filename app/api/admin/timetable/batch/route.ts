import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { matchOrCreateArtist } from "@/lib/ingestion/artist-matcher";
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

  if (body.replaceExisting) {
    await supabase
      .from("timetable_performances")
      .delete()
      .eq("event_id", body.event_id);
  }

  let inserted = 0;
  const errors: string[] = [];

  for (const perf of body.performances) {
    if (!perf.artist_name?.trim()) continue;

    const artistId = await matchOrCreateArtist(perf.artist_name.trim());

    const { error } = await supabase.from("timetable_performances").insert({
      event_id: body.event_id,
      artist_id: artistId,
      artist_name: perf.artist_name.trim(),
      stage_name: perf.stage_name?.trim() ?? "",
      start_time: perf.start_time?.trim() ?? "",
      end_time: perf.end_time?.trim() ?? "",
      day_number: perf.day_number ?? 1,
      date_string: perf.date_string?.trim() ?? "",
      genre: "",
    });

    if (error) {
      errors.push(`${perf.artist_name}: ${error.message}`);
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

  return NextResponse.json({ ok: true, inserted, errors });
}
