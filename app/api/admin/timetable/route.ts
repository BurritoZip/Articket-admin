import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import type { TimetablePerformanceRow } from "@/types/timetable";

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const eventId = url.searchParams.get("event_id");

  if (!eventId) {
    return NextResponse.json({ error: "event_id_required" }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("timetable_performances")
    .select("*")
    .eq("event_id", eventId)
    .order("day_number", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    if ((error as { code?: string }).code === "42P01") {
      return NextResponse.json({ rows: [] });
    }
    return NextResponse.json(
      { error: "list_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ rows: (data ?? []) as TimetablePerformanceRow[] });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Partial<TimetablePerformanceRow>;

  if (
    !body.event_id ||
    !body.day_number ||
    !body.date_string?.trim() ||
    !body.start_time?.trim() ||
    !body.end_time?.trim() ||
    !body.artist_name?.trim() ||
    !body.stage_name?.trim()
  ) {
    return NextResponse.json(
      { error: "missing_required_fields" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("timetable_performances")
    .insert({
      event_id: body.event_id,
      artist_id: body.artist_id ?? null,
      day_number: body.day_number,
      date_string: body.date_string.trim(),
      start_time: body.start_time.trim(),
      end_time: body.end_time.trim(),
      artist_name: body.artist_name.trim(),
      stage_name: body.stage_name.trim(),
      genre: body.genre?.trim() ?? "",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "create_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, row: data });
}
