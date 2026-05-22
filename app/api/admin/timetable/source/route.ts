import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-handler";
import { deriveTimetableTextForEvent } from "@/lib/ingestion/timetable-source";
import { requireAdmin } from "@/lib/supabase/require-admin";

export const GET = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const eventId = url.searchParams.get("event_id")?.trim();
  if (!eventId) {
    return NextResponse.json(
      { error: "event_id_required" },
      { status: 400 },
    );
  }

  const source = await deriveTimetableTextForEvent(eventId);
  return NextResponse.json({ ok: true, source });
});
