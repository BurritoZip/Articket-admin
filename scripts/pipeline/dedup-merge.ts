/**
 * 진짜 중복 병합 — 같은 normalized_title + 같은 공연일(start_date) 클러스터만.
 * 전국투어(날짜 다름)·라인업은 건드리지 않는다.
 *
 * canonical 1개 남기고(artist_id>venue_id>오래된순 우선) source_urls 합친 뒤 나머지 삭제(cascade).
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/pipeline/dedup-merge.ts          # 미리보기
 *   npx tsx --env-file=.env.local scripts/pipeline/dedup-merge.ts --apply  # 병합 실행
 */
import { createServiceRoleClient } from "../../lib/supabase/service-role";

interface Ev {
  id: string;
  title: string;
  normalized_title: string | null;
  start_date: string | null;
  artist_id: string | null;
  venue_id: string | null;
  source_urls: string[] | null;
  created_at: string;
}

function normTitle(e: Ev): string {
  return (e.normalized_title ?? e.title ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[!-/:-@[-`{-~~·…“”‘’\-–—()[\]<>「」『』【】、，。!?]/g, "");
}

async function fetchAll(): Promise<Ev[]> {
  const db = createServiceRoleClient();
  const all: Ev[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db
      .from("events")
      .select(
        "id,title,normalized_title,start_date,artist_id,venue_id,source_urls,created_at",
      )
      .range(f, f + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...(data as Ev[]));
    if (data.length < 1000) break;
  }
  return all;
}

function pickCanonical(members: Ev[]): Ev {
  return [...members].sort((a, b) => {
    if (!!a.artist_id !== !!b.artist_id) return a.artist_id ? -1 : 1;
    if (!!a.venue_id !== !!b.venue_id) return a.venue_id ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1; // 오래된 것 우선
  })[0];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = createServiceRoleClient();
  const events = await fetchAll();

  const groups = new Map<string, Ev[]>();
  for (const e of events) {
    const nt = normTitle(e);
    if (nt.length < 3 || !e.start_date) continue;
    const key = `${nt}|${e.start_date.slice(0, 10)}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const dupGroups = Array.from(groups.values()).filter((g) => g.length > 1);
  const toDeleteTotal = dupGroups.reduce((s, g) => s + g.length - 1, 0);
  console.log(
    `진짜중복 클러스터 ${dupGroups.length}개, 삭제대상 ${toDeleteTotal}건, canonical ${dupGroups.length}건 유지`,
  );

  let merged = 0;
  let deleted = 0;
  for (const g of dupGroups) {
    const canon = pickCanonical(g);
    const others = g.filter((e) => e.id !== canon.id);
    // source_urls 합치기
    const urls = new Set<string>(canon.source_urls ?? []);
    for (const o of others) (o.source_urls ?? []).forEach((u) => urls.add(u));

    console.log(
      `\n[${apply ? "MERGE" : "PLAN"}] ${(canon.start_date ?? "").slice(0, 10)} "${canon.title}" x${g.length} → keep ${canon.id.slice(0, 8)}`,
    );

    if (apply) {
      await db
        .from("events")
        .update({ source_urls: Array.from(urls) })
        .eq("id", canon.id);
      const ids = others.map((o) => o.id);
      const { error } = await db.from("events").delete().in("id", ids);
      if (error) {
        console.error("  삭제실패:", error.message);
        continue;
      }
      merged++;
      deleted += ids.length;
    }
  }

  if (apply) console.log(`\n완료 — ${merged}클러스터 병합, ${deleted}건 삭제`);
  else
    console.log(
      `\n실제 병합: npx tsx --env-file=.env.local scripts/pipeline/dedup-merge.ts --apply`,
    );
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
