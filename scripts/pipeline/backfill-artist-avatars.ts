/**
 * 아티스트 avatar 백필 — avatar 없는 활성(노출 공연 보유) 아티스트를 재보강.
 *
 * 배경: avatar 소스인 melon 아티스트 검색 스크래퍼가 사이트 개편으로 죽어 avatar 성공률이 0
 * 이었다(고쳐짐). 그런데 enrichment_status='enriched'(avatar 없이도 마킹됨) 아티스트는
 * queueArtistEnrichment 게이트에서 영구 제외돼 자동으로는 재보강되지 않는다. 이 스크립트가
 * 게이트를 우회해 avatar 결손 활성 아티스트를 강제 재보강한다. avatar 목적이라 melon+naver 만.
 *
 * 사용:
 *   npx tsx --env-file=.env.local scripts/pipeline/backfill-artist-avatars.ts        # 미리보기
 *   npx tsx --env-file=.env.local scripts/pipeline/backfill-artist-avatars.ts --apply
 */
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import { enrichArtist } from "../../lib/artists/enrich";

const APPLY = process.argv.includes("--apply");

async function main() {
  const db = createServiceRoleClient();

  // 노출 공연 보유(활성) 아티스트 id
  const evs: { artist_id: string }[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await db
      .from("events")
      .select("artist_id")
      .eq("is_hidden", false)
      .not("artist_id", "is", null)
      .range(f, f + 999);
    if (!data?.length) break;
    evs.push(...(data as { artist_id: string }[]));
    if (data.length < 1000) break;
  }
  const ids = [...new Set(evs.map((e) => e.artist_id))];

  // 그중 avatar 없는 것
  const targets: { id: string; name: string }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db
      .from("artists")
      .select("id,name")
      .in("id", ids.slice(i, i + 100))
      .is("avatar_url", null);
    targets.push(...((data as { id: string; name: string }[]) ?? []));
  }

  console.log(`활성 아티스트 ${ids.length}명, avatar 없음 ${targets.length}명`);
  if (!APPLY) {
    console.log("미리보기. --apply 로 실제 보강.");
    return;
  }

  let filled = 0;
  let done = 0;
  for (const a of targets) {
    try {
      const r = await enrichArtist(a.id, {
        force: true,
        sources: ["melon", "naver"],
      });
      if (r.addedFields.includes("avatar_url")) filled++;
    } catch {
      /* 개별 실패는 넘어감 */
    }
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${targets.length} (avatar 채움 ${filled})`);
  }
  console.log(`\n완료: ${done}명 처리, avatar 채움 ${filled}명`);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
