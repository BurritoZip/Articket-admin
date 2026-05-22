import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-handler";
import { importTimetableText } from "@/lib/ingestion/timetable-import";
import { requireAdmin } from "@/lib/supabase/require-admin";

export const POST = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    event_id?: string;
    text?: string;
    replaceExisting?: boolean;
  };

  if (!body.event_id || !body.text?.trim()) {
    return NextResponse.json(
      { error: "event_id_and_text_required" },
      { status: 400 },
    );
  }

  const result = await importTimetableText({
    eventId: body.event_id,
    text: body.text,
    replaceExisting: body.replaceExisting,
  });

  return NextResponse.json({ ok: true, result });
});
