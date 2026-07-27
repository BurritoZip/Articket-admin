/**
 * dedup_key 재계산 + 기존 중복 collapse. dedup_key 가 UNIQUE 라 "흡수(삭제) → 생존 행 키 세팅" 순서.
 * 실행: npx tsx scripts/pipeline/recompute-match-keys.ts [--dry]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const line of readFileSync(
  resolve(process.cwd(), ".env.local"),
  "utf8",
).split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!process.env[k])
      process.env[k] = line
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
}

type Ev = {
  id: string;
  title: string;
  normalized_title: string | null;
  start_date: string | null;
  venue_id: string | null;
  created_at: string;
  dedup_key: string | null;
};

async function main() {
  const dry = process.argv.includes("--dry");
  const { createServiceRoleClient } =
    await import("../../lib/supabase/service-role");
  const { eventDedupKey } = await import("../../lib/ingestion/match-key");
  const { absorbEvents } = await import("../../lib/ingestion/event-auto-merge");
  const db = createServiceRoleClient();

  // 활성 이벤트 fetch
  const all: Ev[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await db
      .from("events")
      .select(
        "id,title,normalized_title,start_date,venue_id,created_at,dedup_key",
      )
      .is("merged_into_event_id", null)
      .eq("is_hidden", false)
      .range(f, f + 999);
    if (!data?.length) break;
    all.push(...(data as Ev[]));
    if (data.length < 1000) break;
  }

  // 공연장 정규화명 조회(키 계산용)
  const venueIds = Array.from(
    new Set(all.map((e) => e.venue_id).filter(Boolean)),
  ) as string[];
  const vname = new Map<string, string>();
  for (let i = 0; i < venueIds.length; i += 500) {
    const { data } = await db
      .from("venues")
      .select("id,normalized_name")
      .in("id", venueIds.slice(i, i + 500));
    for (const v of (data as {
      id: string;
      normalized_name: string | null;
    }[]) ?? [])
      vname.set(v.id, v.normalized_name ?? "");
  }

  // 새 키로 그룹핑
  const groups = new Map<string, Ev[]>();
  for (const e of all) {
    const key = eventDedupKey(
      e.title,
      e.venue_id ? (vname.get(e.venue_id) ?? null) : null,
      e.start_date,
    );
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }

  const dupGroups = Array.from(groups.entries()).filter(
    ([, g]) => g.length > 1,
  );
  console.log(
    `이벤트 ${all.length}, 새 키 그룹 ${groups.size}, 중복 그룹 ${dupGroups.length}, 흡수 예정 ${dupGroups.reduce((n, [, g]) => n + g.length - 1, 0)}`,
  );

  if (dry) {
    for (const [key, g] of dupGroups.slice(0, 40)) {
      console.log(`\n[${key.slice(0, 10)}]`);
      for (const e of g)
        console.log(
          `  "${e.title.slice(0, 45)}" ${e.start_date?.slice(0, 10)} v=${e.venue_id?.slice(0, 8)}`,
        );
    }
    console.log("\n(--dry. 적용하려면 --dry 없이)");
    return;
  }

  // canonical = 정보량/최초등록 우선(간이): 아티스트 있으면… 여기선 created_at 최소 + 제목 김을 canonical.
  let collapsed = 0,
    keyed = 0;
  for (const [key, g] of dupGroups) {
    const canon = [...g].sort(
      (a, b) =>
        (b.title?.length ?? 0) - (a.title?.length ?? 0) ||
        (a.created_at < b.created_at ? -1 : 1),
    )[0];
    const others = g.filter((e) => e.id !== canon.id).map((e) => e.id);
    const n = await absorbEvents(db, canon.id, others, "recompute_collapse");
    collapsed += n;
    // 생존 행 키 세팅(흡수로 충돌 행 삭제됨 → UNIQUE 안전)
    const { error } = await db
      .from("events")
      .update({ dedup_key: key })
      .eq("id", canon.id);
    if (!error) keyed++;
  }
  // 단일 그룹(중복 아님)도 키 갱신
  for (const [key, g] of Array.from(groups)) {
    if (g.length !== 1) continue;
    if (g[0].dedup_key === key) continue;
    await db.from("events").update({ dedup_key: key }).eq("id", g[0].id);
    keyed++;
  }
  console.log(`\n흡수 ${collapsed}, 키 갱신 ${keyed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
