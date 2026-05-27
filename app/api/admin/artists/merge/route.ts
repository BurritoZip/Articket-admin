import { requireAdmin } from "@/lib/supabase/require-admin";
import { mergeArtists } from "@/lib/artists/merge";
import { withErrorHandler } from "@/lib/api-handler";
import { NextResponse } from "next/server";

interface SingleMergeBody {
  keepId: string;
  mergeId: string;
}

interface BulkMergeBody {
  pairs: Array<{ keepId: string; mergeId: string }>;
}

type MergeBody = SingleMergeBody | BulkMergeBody;

function isBulk(b: MergeBody): b is BulkMergeBody {
  return "pairs" in b;
}

export const POST = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as MergeBody;

  // ── 단일 머지 ────────────────────────────────────────────────
  if (!isBulk(body)) {
    const { keepId, mergeId } = body;

    if (!keepId || !mergeId) {
      return NextResponse.json({ error: "keepId, mergeId 필수" }, { status: 400 });
    }
    if (keepId === mergeId) {
      return NextResponse.json({ error: "keepId와 mergeId가 같습니다" }, { status: 400 });
    }

    const result = await mergeArtists({ keepId, mergeId });

    if (result.errors.length > 0) {
      console.error("[Merge] 오류 발생:", result.errors);
    }

    return NextResponse.json({ ok: true, result });
  }

  // ── 배치 머지 ─────────────────────────────────────────────────
  const { pairs } = body;

  if (!Array.isArray(pairs) || pairs.length === 0) {
    return NextResponse.json({ error: "pairs 배열이 비어있습니다" }, { status: 400 });
  }
  if (pairs.length > 50) {
    return NextResponse.json({ error: "한 번에 최대 50쌍까지 머지 가능합니다" }, { status: 400 });
  }

  const results = [];
  for (const { keepId, mergeId } of pairs) {
    try {
      if (!keepId || !mergeId || keepId === mergeId) {
        results.push({ keepId, mergeId, ok: false, error: "유효하지 않은 ID" });
        continue;
      }
      const result = await mergeArtists({ keepId, mergeId });
      results.push({ keepId, mergeId, ok: true, result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ keepId, mergeId, ok: false, error: msg });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: true, succeeded, total: pairs.length, results });
});
