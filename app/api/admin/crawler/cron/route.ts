/**
 * 멀티소스 크롤링 + 파이프라인 실행 엔드포인트 (curl/launchd cron)
 *
 * 로컬 launchd(trigger-python.sh)에서 curl 로 호출.
 * CRON_SECRET 환경변수 설정 시 Authorization: Bearer <secret> 헤더 필요.
 *
 * 8단계 로직은 lib/pipeline/run-pipeline.ts 한 곳에만 있다(세 진입점 공유).
 */
import { NextResponse, type NextRequest } from "next/server";
import { runFullPipeline } from "@/lib/pipeline/run-pipeline";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Cron 인증 확인
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runFullPipeline({
      trigger: "cron",
      enrichBudgetMs: 180_000,
      log: (msg) => console.log(`[Cron] ${msg}`),
    });
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Cron] 파이프라인 실패:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
