/**
 * 이벤트 자동 병합 — 같은 제목 + 같은 공연일(start_date) 중복을 1개로 합친다.
 *
 * 왜 필요한가: ingest dedup_key 는 `제목|공연장|공연일` 이라, 같은 공연이 다른 소스에서
 * 공연장명을 다르게(또는 null) 달고 들어오면 dedup_key 가 달라져 중복 행이 생긴다.
 * 파이프라인 merge 단계에서 매번 청소해 중복이 쌓이지 않게 한다.
 *
 * 정책: 전국투어·N차 라인업은 보존 — 반드시 "공연일까지 동일"한 것만 병합한다.
 * canonical 선택 우선순위: artist_id 보유 > venue_id 보유 > 오래된 것.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";

interface Ev {
  id: string;
  title: string;
  normalized_title: string | null;
  start_date: string | null;
  artist_id: string | null;
  venue_id: string | null;
  source_urls: { site?: string; url?: string }[] | null;
  created_at: string;
}

function normTitle(e: Ev): string {
  return (e.normalized_title ?? e.title ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[!-/:-@[-`{-~~·…“”‘’\-–—()[\]<>「」『』【】、，。!?]/g, "");
}

function pickCanonical(members: Ev[]): Ev {
  return [...members].sort((a, b) => {
    if (!!a.artist_id !== !!b.artist_id) return a.artist_id ? -1 : 1;
    if (!!a.venue_id !== !!b.venue_id) return a.venue_id ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  })[0];
}

export async function autoMergeDuplicateEvents(): Promise<{
  clusters: number;
  deleted: number;
}> {
  const db = createServiceRoleClient();
  const all: Ev[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await db
      .from("events")
      .select(
        "id,title,normalized_title,start_date,artist_id,venue_id,source_urls,created_at",
      )
      .range(f, f + 999);
    if (!data?.length) break;
    all.push(...(data as Ev[]));
    if (data.length < 1000) break;
  }

  const groups = new Map<string, Ev[]>();
  for (const e of all) {
    const nt = normTitle(e);
    if (nt.length < 3 || !e.start_date) continue;
    const key = `${nt}|${String(e.start_date).slice(0, 10)}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  let clusters = 0;
  let deleted = 0;
  for (const g of Array.from(groups.values())) {
    if (g.length < 2) continue;
    const canon = pickCanonical(g);
    const others = g.filter((e) => e.id !== canon.id);
    const urls = new Map<string, { site?: string; url?: string }>();
    for (const s of canon.source_urls ?? [])
      urls.set(JSON.stringify(s), s);
    for (const o of others)
      for (const s of o.source_urls ?? []) urls.set(JSON.stringify(s), s);

    await db
      .from("events")
      .update({ source_urls: Array.from(urls.values()) })
      .eq("id", canon.id);
    const { error } = await db
      .from("events")
      .delete()
      .in(
        "id",
        others.map((o) => o.id),
      );
    if (error) continue;
    clusters++;
    deleted += others.length;
  }

  return { clusters, deleted };
}
