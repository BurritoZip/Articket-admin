import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { processArtistEnrichmentQueue } from "@/lib/artists/enrich";

export const maxDuration = 300;

// 큐가 빌 때까지 반복 처리 (최대 5분)
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // CRON_SECRET 있으면 크론 호출 허용, 없으면 관리자 확인
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // cron 호출 — 인증 통과
  } else {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;
  }

  const deadline = Date.now() + 270_000; // 4분 30초 (maxDuration 여유)
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let rounds = 0;

  while (Date.now() < deadline) {
    const result = await processArtistEnrichmentQueue(50);
    totalProcessed += result.processed;
    totalSucceeded += result.succeeded;
    totalFailed += result.failed;
    rounds++;

    if (result.processed === 0) break; // 큐 비었음
  }

  return NextResponse.json({
    ok: true,
    rounds,
    processed: totalProcessed,
    succeeded: totalSucceeded,
    failed: totalFailed,
  });
}
