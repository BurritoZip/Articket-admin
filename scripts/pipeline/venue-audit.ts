import { createServiceRoleClient } from "../../lib/supabase/service-role";

async function main() {
  const db = createServiceRoleClient();

  const { count: total } = await db
    .from("venues")
    .select("*", { count: "exact", head: true });

  const { data: garbage, count: garbageCount } = await db
    .from("venues")
    .select("id, name", { count: "exact" })
    .or(
      "name.ilike.%예매하기%,name.ilike.%단독공연%,name.ilike.%콘서트%,name.ilike.%페스티벌%,name.ilike.%공연%",
    )
    .limit(10);

  const { data: withHall, count: hallCount } = await db
    .from("venues")
    .select("id, name", { count: "exact" })
    .or(
      "name.ilike.%대극장%,name.ilike.%소극장%,name.ilike.%중극장%,name.ilike.%전시장%,name.ilike.% 홀%,name.ilike.%번홀%,name.ilike.%번관%",
    )
    .not("name", "ilike", "%예매하기%")
    .not("name", "ilike", "%공연%")
    .limit(30);

  const { data: addrVenues, count: addrCount } = await db
    .from("venues")
    .select("id, name", { count: "exact" })
    .or(
      "name.ilike.서울%,name.ilike.부산%,name.ilike.경기%,name.ilike.강원%,name.ilike.인천%,name.ilike.경남%,name.ilike.경북%",
    )
    .not("name", "ilike", "%예매하기%")
    .limit(10);

  const { data: allNames } = await db.from("venues").select("name").limit(3000);
  const nameCount: Record<string, number> = {};
  for (const v of allNames ?? []) {
    nameCount[v.name] = (nameCount[v.name] ?? 0) + 1;
  }
  const dups = Object.entries(nameCount)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1]);

  console.log(`\n총 venue: ${total}개`);

  console.log(`\n[오염: 이벤트 제목 포함] ${garbageCount}개`);
  for (const v of garbage ?? []) console.log(`  "${v.name.slice(0, 80)}"`);

  console.log(`\n[세부홀 포함] ${hallCount}개`);
  for (const v of withHall ?? []) console.log(`  "${v.name}"`);

  console.log(`\n[주소형 venue] ${addrCount}개`);
  for (const v of addrVenues ?? []) console.log(`  "${v.name}"`);

  console.log(`\n[중복 venue 이름] ${dups.length}개`);
  for (const [n, c] of dups.slice(0, 20)) console.log(`  (${c}회) "${n}"`);
}

main().catch(console.error);
