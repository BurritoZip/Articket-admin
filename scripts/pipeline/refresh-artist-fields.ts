import { createServiceRoleClient } from "../../lib/supabase/service-role";

// occupation = 장르 의미로 재정의됨. 기존 occupation에 든 "직업" 텍스트(가수/배우 등)를 비우고,
// country(전량 null)·occupation을 새 소스 매핑으로 다시 채우도록 enrichment_status='pending' 마킹.
// 이후 backfill-artist-profiles.ts 재실행하면 수정된 소스가 장르/국적을 채운다.
const JOB =
  /가수|배우|성우|모델|방송인|예능|프로듀서|드러머|기타리스트|베이시스트|작곡가|작사가?|아나운서|유튜버|만화가|군인|개그맨|진행자|싱어송라이터|음악가|뮤지션|디스크\s?자키|\bDJ\b|Singer|[Aa]ctor|[Aa]ctress|rapper|producer|musician|Voice|comedian/;

async function main() {
  const db = createServiceRoleClient();

  // 1) occupation에 직업 텍스트가 든 레코드 → occupation null (장르로 재보강되게)
  const dirtyOcc: string[] = [];
  let from = 0;
  for (;;) {
    const { data } = await db
      .from("artists")
      .select("id,occupation")
      .not("occupation", "is", null)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const a of data) if (a.occupation && JOB.test(a.occupation)) dirtyOcc.push(a.id);
    if (data.length < 1000) break;
    from += 1000;
  }
  for (let i = 0; i < dirtyOcc.length; i += 100) {
    await db.from("artists").update({ occupation: null }).in("id", dirtyOcc.slice(i, i + 100));
  }
  console.log(`occupation 직업텍스트 정제: ${dirtyOcc.length}건 → null`);

  // 2) 재보강 대상 표시 — country가 비었거나 occupation을 비운 레코드
  //    (이미 enriched여도 country/occupation 갱신 위해 pending 으로)
  const { error: e1 } = await db
    .from("artists")
    .update({ enrichment_status: "pending" })
    .or("country.is.null,occupation.is.null");
  console.log(`재보강 대상(pending) 마킹 ${e1 ? "실패: " + e1.message : "완료"}`);
}
main().catch(console.error);
