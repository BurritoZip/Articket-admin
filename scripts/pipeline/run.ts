/**
 * 로컬 파이프라인 실행 스크립트
 * trigger-python.sh 에서 npx tsx scripts/pipeline/run.ts 로 호출.
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수 필요.
 *
 * 8단계 로직은 lib/pipeline/run-pipeline.ts 한 곳에만 있다(세 진입점 공유).
 * 로컬은 서버리스 maxDuration 제약이 없어 enrich 큐 드레인을 넉넉히(270s) 준다.
 */
import { runFullPipeline } from "../../lib/pipeline/run-pipeline";

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

async function main() {
  log("=== 파이프라인 시작 ===");
  await runFullPipeline({ trigger: "local-cron", enrichBudgetMs: 270_000, log });
  log("=== 파이프라인 완료 ===");
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
