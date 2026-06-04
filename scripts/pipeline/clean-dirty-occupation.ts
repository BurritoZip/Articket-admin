import { createServiceRoleClient } from "../../lib/supabase/service-role";

// occupation에 위키 CSS/HTML 잔재(.mw-parser-output, {}, parser-output)가 섞인 아티스트를
// 찾아 occupation=null + enrichment_status='pending' 으로 되돌린다 → 수정된 파서로 재보강.
const DIRTY = /\.mw-|parser-output|[{}]/;

async function main() {
  const db = createServiceRoleClient();
  const dirty: { id: string; name: string }[] = [];

  let from = 0;
  for (;;) {
    const { data } = await db
      .from("artists")
      .select("id,name,occupation")
      .not("occupation", "is", null)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const a of data) {
      if (a.occupation && DIRTY.test(a.occupation)) dirty.push({ id: a.id, name: a.name });
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  console.log(`오염 occupation: ${dirty.length}건`);
  for (const d of dirty.slice(0, 20)) console.log(`  - ${d.name}`);

  // 청소 + 재보강 대상으로 표시
  for (let i = 0; i < dirty.length; i += 100) {
    const ids = dirty.slice(i, i + 100).map((d) => d.id);
    await db
      .from("artists")
      .update({ occupation: null, enrichment_status: "pending" })
      .in("id", ids);
  }
  console.log(`\n${dirty.length}건 occupation 초기화 + pending 마킹 완료 (재보강 대상)`);
}
main().catch(console.error);
