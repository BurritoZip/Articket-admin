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
  // 영숫자+한글만 남기고 전부 제거 — 전각/반각 문장부호(＃#·．.·［］[] 등) 차이를 흡수.
  return (e.normalized_title ?? e.title ?? "")
    .normalize("NFKC") // 전각→반각 정규화
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, "");
}

function dayOf(e: Ev): string | null {
  return e.start_date ? String(e.start_date).slice(0, 10) : null;
}

function sourceSet(e: Ev): Set<string> {
  const s = new Set<string>();
  for (const u of e.source_urls ?? []) if (u?.site) s.add(u.site);
  return s;
}

/** 아티스트 링크 보유 우선 → 서술적인(긴) 제목 → 먼저 등록된 행 */
function pickCanonical(members: Ev[]): Ev {
  return [...members].sort((a, b) => {
    if (!!a.artist_id !== !!b.artist_id) return a.artist_id ? -1 : 1;
    const lt = (b.title?.length ?? 0) - (a.title?.length ?? 0);
    if (lt !== 0) return lt;
    return a.created_at < b.created_at ? -1 : 1;
  })[0];
}

async function fetchAll(
  db: ReturnType<typeof createServiceRoleClient>,
): Promise<Ev[]> {
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
      g.forEach((e) => consumed.add(e.id));
    }
  }

  // 패스 3: 같은 공연일 + 제목 truncation(한쪽 제목이 다른쪽의 접두사).
  //   크롤 소스가 제목을 잘라 저장해 생기는 중복("...[ddbb X" vs "...[ddbb X 베리코이버니]").
  //   접두 길이 15자 이상만 — 짧은 제목 오매칭 방지.
  const byDay = new Map<string, Ev[]>();
  for (const e of all) {
    if (consumed.has(e.id)) continue;
    const day = dayOf(e);
    if (!day || normTitle(e).length < 15) continue;
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(e);
  }
  for (const group of Array.from(byDay.values())) {
    if (group.length < 2) continue;
    // 제목 짧은 것부터 — 접두사 후보
    const sorted = [...group].sort(
      (a, b) => normTitle(a).length - normTitle(b).length,
    );
    for (let i = 0; i < sorted.length; i++) {
      if (consumed.has(sorted[i].id)) continue;
      const shortN = normTitle(sorted[i]);
      const cluster = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) {
        if (consumed.has(sorted[j].id)) continue;
        if (normTitle(sorted[j]).startsWith(shortN)) cluster.push(sorted[j]);
      }
      if (cluster.length > 1) {
        const n = await mergeCluster(db, cluster);
        if (n > 0) {
          clusters++;
          deleted += n;
          cluster.forEach((e) => consumed.add(e.id));
        }
      }
    }
  }

  // 패스 4: 크로스소스 중복 — 같은 제목 + 시작일 2일 이내 + 소스 겹치지 않음.
  //   서로 다른 크롤러가 같은 공연을 시작일만 다르게 올린 경우(예: 06-12 vs 06-13).
  //   같은 소스의 근접 날짜는 진짜 회차(예: 2일 공연)일 수 있어 보존(소스 겹침으로 구분).
  const TWO_DAYS = 2 * 86_400_000;
  const byTitle4 = new Map<string, Ev[]>();
  for (const e of all) {
    if (consumed.has(e.id)) continue;
    const nt = normTitle(e);
    if (nt.length < 5 || !e.start_date) continue;
    (byTitle4.get(nt) ?? byTitle4.set(nt, []).get(nt)!).push(e);
  }
  for (const group of Array.from(byTitle4.values())) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) =>
      String(a.start_date) < String(b.start_date) ? -1 : 1,
    );
    for (let i = 0; i < sorted.length; i++) {
      if (consumed.has(sorted[i].id)) continue;
      const baseDay = Date.parse(String(sorted[i].start_date).slice(0, 10));
      const srcUnion = sourceSet(sorted[i]);
      if (srcUnion.size === 0) continue; // 소스 미상 — 비교 불가, 스킵
      const cluster = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) {
        if (consumed.has(sorted[j].id)) continue;
        const day = Date.parse(String(sorted[j].start_date).slice(0, 10));
        if (Math.abs(day - baseDay) > TWO_DAYS) continue;
        const s = sourceSet(sorted[j]);
        if (s.size === 0) continue;
        // 소스가 겹치면 같은 크롤러의 별개 회차 → 병합 안 함
        if (Array.from(s).some((x) => srcUnion.has(x))) continue;
        cluster.push(sorted[j]);
        s.forEach((x) => srcUnion.add(x));
      }
      if (cluster.length > 1) {
        const n = await mergeCluster(db, cluster);
        if (n > 0) {
          clusters++;
          deleted += n;
          cluster.forEach((e) => consumed.add(e.id));
        }
      }
    }
  }

  // 패스 5: 같은 공연일 + (같은 공연장 OR 제목 포함관계) — 소스마다 제목 표기가 다른 동일 공연.
  //   예) "[부산] …빈백콘서트"(yes24) vs "…빈백콘서트 - 부산"(stagepick) — 같은 공연장+날짜
  //       "포스트 말론 내한공연"(interpark) vs "Post Malone 포스트말론 내한공연" — 제목 포함관계
  //   안전장치: 같은공연장 매칭은 공통 부분문자열 6자 이상일 때만(페스티벌 다른 출연 오병합 방지).
  const lcsLen = (a: string, b: string): number => {
    let best = 0;
    const dp = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let prev = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : 0;
        if (dp[j] > best) best = dp[j];
        prev = tmp;
      }
    }
    return best;
  };
  const dupP5 = (a: Ev, b: Ev): boolean => {
    const na = normTitle(a);
    const nb = normTitle(b);
    if (na.length < 6 || nb.length < 6) return false;
    // 제목 포함관계(한쪽이 다른쪽에 통째로 들어감, 8자 이상)
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length <= nb.length ? nb : na;
    if (shorter.length >= 8 && longer.includes(shorter)) return true;
    // 같은 공연장 + 공통 부분문자열 6자 이상
    if (a.venue_id && b.venue_id && a.venue_id === b.venue_id)
      return lcsLen(na, nb) >= 6;
    return false;
  };
  const byDay5 = new Map<string, Ev[]>();
  for (const e of all) {
    if (consumed.has(e.id)) continue;
    const day = dayOf(e);
    if (!day) continue;
    (byDay5.get(day) ?? byDay5.set(day, []).get(day)!).push(e);
  }
  for (const group of Array.from(byDay5.values())) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      if (consumed.has(group[i].id)) continue;
      const cluster = [group[i]];
      for (let j = i + 1; j < group.length; j++) {
        if (consumed.has(group[j].id)) continue;
        if (dupP5(group[i], group[j])) cluster.push(group[j]);
      }
      if (cluster.length > 1) {
        const n = await mergeCluster(db, cluster);
        if (n > 0) {
          clusters++;
          deleted += n;
          cluster.forEach((e) => consumed.add(e.id));
        }
      }
    }
  }

  return { clusters, deleted };
}
