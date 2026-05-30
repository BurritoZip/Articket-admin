import { createServiceRoleClient } from "../../lib/supabase/service-role";
import { geminiText } from "../../lib/gemini";

async function main() {
  const db = createServiceRoleClient();

  // 1. artist_id 없는 이벤트 소스별 현황
  const { data: bySource } = await db.from("events")
    .select("source_name")
    .is("artist_id", null)
    .limit(3000);

  const srcMap: Record<string, number> = {};
  for (const e of bySource ?? []) {
    srcMap[e.source_name] = (srcMap[e.source_name] ?? 0) + 1;
  }
  console.log("\n[소스별 artist_id 없는 이벤트]");
  for (const [src, cnt] of Object.entries(srcMap).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${cnt}개`);
  }

  // 2. 샘플 제목 + Gemini 테스트 5개
  const { data: samples } = await db.from("events")
    .select("id,title,source_name")
    .is("artist_id", null)
    .not("status", "eq", "ended")
    .order("start_date", { ascending: false })
    .limit(5);

  console.log("\n[Gemini 아티스트 추출 테스트]");
  for (const e of samples ?? []) {
    const prompt = `다음 공연/콘서트 제목에서 주요 아티스트(가수/그룹) 이름만 추출하세요. 아티스트 이름이 없거나 확실하지 않으면 "없음"이라고만 답변하세요.\n공연 제목: "${e.title}"\n아티스트 이름만 (없으면 "없음"):`;
    const result = await geminiText(prompt).then(s => s.trim()).catch(() => "ERROR");
    console.log(`  [${e.source_name}] ${e.title}`);
    console.log(`  → Gemini: "${result}"\n`);
  }
}
main().catch(console.error);
