import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import type { TimetablePerformanceRow } from "@/types/timetable";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Partial<TimetablePerformanceRow>;

  const payload: Partial<TimetablePerformanceRow> = {};
  if (body.artist_id !== undefined) payload.artist_id = body.artist_id;
  if (body.day_number !== undefined) payload.day_number = body.day_number;
  if (body.date_string !== undefined)
    payload.date_string = body.date_string.trim();
  if (body.start_time !== undefined)
    payload.start_time = body.start_time.trim();
  if (body.end_time !== undefined) payload.end_time = body.end_time.trim();
  if (body.artist_name !== undefined)
    payload.artist_name = body.artist_name.trim();
  if (body.stage_name !== undefined)
    payload.stage_name = body.stage_name.trim();
  if (body.genre !== undefined) payload.genre = body.genre.trim();

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("timetable_performances")
    .update(payload)
    .eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: "update_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("timetable_performances")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: "delete_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
