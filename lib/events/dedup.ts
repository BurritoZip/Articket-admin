/**
 * 이벤트 중복 후보 탐지 (수동 검토용)
 *
 * 파이프라인 auto-merge(`autoMergeDuplicateEvents`)는 "같은 공연일"을 gate 로 확신 높은
 * 중복만 자동 병합한다. 그래서 여기 남는 건 auto-merge 가 **일부러 안 건드린** 저확신 후보다:
 *   A. same_title_diff_day  — 정규화 제목 동일한데 공연일이 다름 (날짜 오크롤 phantom vs 정상 투어)
 *   B. same_artist_similar  — 같은 아티스트 + 제목 포함관계인데 공연일이 다름 (회차 vs 중복)
 * 둘 다 사람이 투어/회차인지 진짜 중복인지 판단해야 하므로 UI 로 올린다. (아티스트 dedup 미러)
 *
 * 모든 병합은 관리자가 수동 confirm — 자동 병합 없음.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type EventDedupReason =
  | "same_title_diff_day" // 정규화 제목 동일, 공연일 다름
  | "same_artist_similar"; // 같은 아티스트 + 제목 포함관계, 공연일 다름

export interface EventDedupMember {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  venue_name: string | null;
  artist_name: string | null;
  poster_url: string | null;
  sources: string[];
  info_score: number;
  created_at: string;
}

export interface EventDedupCandidate {
  suggestedKeepId: string;
  members: EventDedupMember[];
  reason: EventDedupReason;
  similarity: number; // 0~1
}

interface Ev {
  id: string;
  title: string;
  normalized_title: string | null;
  start_date: string | null;
  end_date: string | null;
  artist_id: string | null;
  venue_id: string | null;
  poster_url: string | null;
  genre: string | null;
  age_restriction: string | null;
  ticket_open_date: string | null;
  ticket_provider: string | null;
  notice_text: string | null;
  booking_url: string | null;
  source_urls: { site?: string; url?: string }[] | null;
  created_at: string;
}

// event-auto-merge.ts 와 동일한 정규화(전각→반각, 기호 제거). 검출용 로컬 사본.
function normTitle(e: Ev): string {
  return (e.normalized_title ?? e.title ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, "");
}

function dayOf(e: Ev): string | null {
  return e.start_date ? String(e.start_date).slice(0, 10) : null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function infoScore(e: Ev): number {
  const cols: (keyof Ev)[] = [
    "poster_url",
    "genre",
    "age_restriction",
    "ticket_open_date",
    "ticket_provider",
    "notice_text",
    "booking_url",
    "venue_id",
    "end_date",
  ];
  return cols.reduce((n, c) => n + (isBlank(e[c]) ? 0 : 1), 0);
}

function sourcesOf(e: Ev): string[] {
  const s = new Set<string>();
  for (const u of e.source_urls ?? []) if (u?.site) s.add(u.site);
  return Array.from(s);
}

/** 정보량 많은 → 먼저 등록된 행을 keep 추천 (auto-merge pickCanonical 과 동일 취지) */
function suggestKeep(members: Ev[]): string {
  return [...members].sort((a, b) => {
    if (!!a.artist_id !== !!b.artist_id) return a.artist_id ? -1 : 1;
    const si = infoScore(b) - infoScore(a);
    if (si !== 0) return si;
    return a.created_at < b.created_at ? -1 : 1;
  })[0].id;
}

async function fetchActive(
  db: ReturnType<typeof createServiceRoleClient>,
): Promise<Ev[]> {
  const all: Ev[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await db
      .from("events")
      // prettier-ignore — 한 줄 리터럴이어야 supabase-js 가 행 타입을 추론한다
      .select(
        "id,title,normalized_title,start_date,end_date,artist_id,venue_id,poster_url,genre,age_restriction,ticket_open_date,ticket_provider,notice_text,booking_url,source_urls,created_at",
      )
      .is("merged_into_event_id", null)
      .eq("is_hidden", false)
      .range(f, f + 999);
    if (!data?.length) break;
    all.push(...(data as Ev[]));
    if (data.length < 1000) break;
  }
  return all;
}

export async function findDuplicateEventGroups(opts?: {
  limit?: number;
}): Promise<EventDedupCandidate[]> {
  const limit = Math.min(opts?.limit ?? 100, 500);
  const db = createServiceRoleClient();
  const all = await fetchActive(db);

  const groups = new Map<string, EventDedupCandidate>();
  const addGroup = (members: Ev[], reason: EventDedupReason, sim: number) => {
    const key = members
      .map((m) => m.id)
      .sort()
      .join("|");
    if (groups.has(key)) return;
    // 표시용 멤버 (venue/artist 이름은 뒤에서 일괄 채움)
    const mem: EventDedupMember[] = [...members]
      .sort((a, b) => infoScore(b) - infoScore(a))
      .map((e) => ({
        id: e.id,
        title: e.title,
        start_date: e.start_date,
        end_date: e.end_date,
        venue_name: e.venue_id ? `__venue:${e.venue_id}` : null,
        artist_name: e.artist_id ? `__artist:${e.artist_id}` : null,
        poster_url: e.poster_url,
        sources: sourcesOf(e),
        info_score: infoScore(e),
        created_at: e.created_at,
      }));
    groups.set(key, {
      suggestedKeepId: suggestKeep(members),
      members: mem,
      reason,
      similarity: sim,
    });
  };

  // A. 정규화 제목 동일 (공연일 다른 쌍 — 같은 날은 auto-merge 가 이미 처리)
  const byTitle = new Map<string, Ev[]>();
  for (const e of all) {
    const nt = normTitle(e);
    if (nt.length < 3) continue;
    (byTitle.get(nt) ?? byTitle.set(nt, []).get(nt)!).push(e);
  }
  for (const g of Array.from(byTitle.values())) {
    if (g.length < 2) continue;
    const days = new Set(g.map(dayOf));
    // 같은 날만 있으면 auto-merge 미실행분 → 그래도 후보(사람이 정리), sim 높게
    const sameDayOnly = days.size <= 1;
    addGroup(g, "same_title_diff_day", sameDayOnly ? 0.97 : 0.85);
  }

  // B. 같은 아티스트 + 제목 포함관계 (다른 날) — 회차/투어 vs 중복 판단
  const byArtist = new Map<string, Ev[]>();
  for (const e of all) {
    if (!e.artist_id) continue;
    (
      byArtist.get(e.artist_id) ??
      byArtist.set(e.artist_id, []).get(e.artist_id)!
    ).push(e);
  }
  for (const g of Array.from(byArtist.values())) {
    if (g.length < 2) continue;
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        // 공연장이 둘 다 지정됐고 서로 다르면 전국투어 → 중복 아님, 제외.
        // (한쪽 null 이면 판단 불가하니 제목 포함관계로만 후보 판단)
        if (g[i].venue_id && g[j].venue_id && g[i].venue_id !== g[j].venue_id)
          continue;
        const a = normTitle(g[i]);
        const b = normTitle(g[j]);
        if (a.length < 6 || b.length < 6) continue;
        const shorter = a.length <= b.length ? a : b;
        const longer = a.length <= b.length ? b : a;
        // 포함관계(7자+)일 때만 — 같은 아티스트의 완전 별개 공연 오검출 방지
        if (shorter.length >= 7 && longer.includes(shorter)) {
          addGroup([g[i], g[j]], "same_artist_similar", 0.75);
        }
      }
    }
  }

  const candidates = Array.from(groups.values()).slice(0, limit);

  // venue/artist 이름 일괄 해석 (플레이스홀더 치환)
  const venueIds = new Set<string>();
  const artistIds = new Set<string>();
  for (const c of candidates)
    for (const m of c.members) {
      if (m.venue_name?.startsWith("__venue:"))
        venueIds.add(m.venue_name.slice(8));
      if (m.artist_name?.startsWith("__artist:"))
        artistIds.add(m.artist_name.slice(9));
    }
  const venueName = new Map<string, string>();
  const artistName = new Map<string, string>();
  if (venueIds.size) {
    const { data } = await db
      .from("venues")
      .select("id,name")
      .in("id", Array.from(venueIds));
    for (const v of (data as { id: string; name: string }[]) ?? [])
      venueName.set(v.id, v.name);
  }
  if (artistIds.size) {
    const { data } = await db
      .from("artists")
      .select("id,name")
      .in("id", Array.from(artistIds));
    for (const a of (data as { id: string; name: string }[]) ?? [])
      artistName.set(a.id, a.name);
  }
  for (const c of candidates)
    for (const m of c.members) {
      if (m.venue_name?.startsWith("__venue:"))
        m.venue_name = venueName.get(m.venue_name.slice(8)) ?? null;
      if (m.artist_name?.startsWith("__artist:"))
        m.artist_name = artistName.get(m.artist_name.slice(9)) ?? null;
    }

  return candidates;
}
