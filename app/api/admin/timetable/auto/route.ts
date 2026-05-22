import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { withErrorHandler } from "@/lib/api-handler";
import { autoImportTimetableForEvent } from "@/lib/ingestion/timetable-auto";

export const POST = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    event_id?: string;
    replaceExisting?: boolean;
  };

  if (!body.event_id) {
    return NextResponse.json({ error: "event_id_required" }, { status: 400 });
  }

  const result = await autoImportTimetableForEvent(
    body.event_id,
    body.replaceExisting ?? false,
  );

  if (!result.ok) {
    const messages: Record<string, string> = {
      event_not_found: "이벤트를 찾을 수 없습니다.",
      no_raw_payload: "크롤링된 원본 데이터가 없습니다. 먼저 크롤러를 실행하세요.",
      no_stagepick_id: "StagePick 공연 ID를 찾을 수 없습니다.",
      no_artists_found: "출연 아티스트 정보를 찾지 못했습니다.",
    };
    return NextResponse.json(
      {
        ok: false,
        reason: result.reason,
        detail: messages[result.reason ?? ""] ?? "아티스트 정보 없음",
      },
      { status: 404 },
    );
  }

  return NextResponse.json(result);
});
