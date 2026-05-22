import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-handler";
import { deriveTimetableTextForEvent } from "@/lib/ingestion/timetable-source";
import { importTimetableText } from "@/lib/ingestion/timetable-import";
import { requireAdmin } from "@/lib/supabase/require-admin";

export const POST = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    event_id?: string;
    text?: string;
    replaceExisting?: boolean;
    autoFetchSource?: boolean;
  };

  if (!body.event_id) {
    return NextResponse.json(
      { error: "event_id_required" },
      { status: 400 },
    );
  }

  let text = body.text?.trim() ?? "";
  let source:
    | Awaited<ReturnType<typeof deriveTimetableTextForEvent>>
    | undefined;
  if (!text && body.autoFetchSource) {
    source = await deriveTimetableTextForEvent(body.event_id);
    text = source.text.trim();
  }
  if (!text) {
    return NextResponse.json(
      {
        error: "timetable_text_not_found",
        source,
      },
      { status: 400 },
    );
  }

  const result = await importTimetableText({
    eventId: body.event_id,
    text,
    replaceExisting: body.replaceExisting,
  });

  return NextResponse.json({ ok: true, result, source });
});
