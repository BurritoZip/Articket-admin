/**
 * 이벤트 자동 병합 — 같은 공연이 제목 표기만 달라(한/영, 연도 접두, 투어명 유무) 중복으로
 * 쌓이는 걸 1개로 합친다.
 *
 * 왜 필요한가: ingest dedup_key 는 `제목|공연장|공연일` 이라 제목 글자가 조금만 달라도
 * 새 행이 생긴다. 예: "2026 5 Seconds Of Summer 내한공연" vs "5 Seconds of Summer 내한 공연".
 *
 * 병합 키 (강 → 약 순서로 2패스):
 *   1) artist_id + 공연일      — 아티스트는 같은 날 두 공연 불가 → 제목 글자 달라도 동일 공연
 *   2) 정규화제목 + 공연일      — 아티스트 미연결(페스티벌 등)분 보강
 * 전국투어·N차 라인업은 "공연일까지 동일"해야 묶이므로 보존된다.
 *
 * canonical: 더 서술적인(긴) 제목 우선 → 표시명이 좋게 남게. created_at 은 클러스터 최소값으로
 * 보존(최초 등록일 유지), source_urls 는 합집합.
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

function dayOf(e: Ev): string | null {
  return e.start_date ? String(e.start_date).slice(0, 10) : null;
}

/** 표시에 더 좋은(서술적인) 제목 우선, 동률이면 먼저 등록된 행 */
function pickCanonical(members: Ev[]): Ev {
  return [...members].sort((a, b) => {
    const lt = (b.title?.length ?? 0) - (a.title?.length ?? 0);
    if (lt !== 0) return lt;
    return a.created_at < b.created_at ? -1 : 1;
  })[0];
}

async function fetchAll(db: ReturnType<typeof createServiceRoleClient>): Promise<Ev[]> {
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
  return all;
}

async function mergeCluster(
  db: ReturnType<typeof createServiceRoleClient>,
  members: Ev[],
): Promise<number> {
  const canon = pickCanonical(members);
  const others = members.filter((e) => e.id !== canon.id);
  if (!others.length) return 0;

  // source_urls 합집합
  const urls = new Map<string, { site?: string; url?: string }>();
  for (const m of members)
    for (const s of m.source_urls ?? []) urls.set(JSON.stringify(s), s);
  // 최초 등록일 보존
  const earliest = members.reduce(
    (min, m) => (m.created_at < min ? m.created_at : min),
    canon.created_at,
  );

  await db
    .from("events")
    .update({ source_urls: Array.from(urls.values()), created_at: earliest })
    .eq("id", canon.id);
  const { error } = await db
    .from("events")
    .delete()
    .in(
      "id",
      others.map((o) => o.id),
    );
  return error ? 0 : others.length;
}

export async function autoMergeDuplicateEvents(): Promise<{
  clusters: number;
  deleted: number;
}> {
  const db = createServiceRoleClient();
  const all = await fetchAll(db);
  const consumed = new Set<string>();
  let clusters = 0;
  let deleted = 0;

  // 패스 1: artist_id + 공연일
  const byArtistDay = new Map<string, Ev[]>();
  for (const e of all) {
    const day = dayOf(e);
    if (!e.artist_id || !day) continue;
    const k = `${e.artist_id}|${day}`;
    (byArtistDay.get(k) ?? byArtistDay.set(k, []).get(k)!).push(e);
  }
  for (const g of Array.from(byArtistDay.values())) {
    if (g.length < 2) continue;
    const n = await mergeCluster(db, g);
    if (n > 0) {
      clusters++;
      deleted += n;
      g.forEach((e) => consumed.add(e.id));
    }
  }

  // 패스 2: 정규화제목 + 공연일 (패스1에서 안 묶인 것만)
  const byTitleDay = new Map<string, Ev[]>();
  for (const e of all) {
    if (consumed.has(e.id)) continue;
    const day = dayOf(e);
    const nt = normTitle(e);
    if (nt.length < 3 || !day) continue;
    const k = `${nt}|${day}`;
    (byTitleDay.get(k) ?? byTitleDay.set(k, []).get(k)!).push(e);
  }
  for (const g of Array.from(byTitleDay.values())) {
    if (g.length < 2) continue;
    const n = await mergeCluster(db, g);
    if (n > 0) {
      clusters++;
      deleted += n;
    }
  }

  return { clusters, deleted };
}
