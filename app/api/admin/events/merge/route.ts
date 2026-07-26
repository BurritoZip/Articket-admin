import { requireAdmin } from "@/lib/supabase/require-admin";
import { mergeEventPair } from "@/lib/ingestion/event-auto-merge";
import { withErrorHandler } from "@/lib/api-handler";
import { NextResponse } from "next/server";

interface MergeBody {
  keepId: string;
  mergeId: string;
}

export const POST = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { keepId, mergeId } = (await request.json()) as MergeBody;

  if (!keepId || !mergeId) {
    return NextResponse.json({ error: "keepId, mergeId 필수" }, { status: 400 });
  }
  if (keepId === mergeId) {
    return NextResponse.json(
      { error: "keepId와 mergeId가 같습니다" },
      { status: 400 },
    );
  }

  const result = await mergeEventPair({ keepId, mergeId });
  if (result.merged === 0) {
    return NextResponse.json(
      { error: "병합 대상을 찾을 수 없습니다(이미 병합/삭제됨)" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, result });
});
