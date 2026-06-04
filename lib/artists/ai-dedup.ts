/**
 * AI 아티스트 중복 병합 — 한글↔영문 음역 + 오타까지 잡는다.
 *
 * 문제: "Charlie Puth" / "찰리 푸스" / "Chalie Puth"(오타) 가 별도 아티스트로 등록됨.
 * exact 정규화 병합은 음역·오타를 못 잡고, normalized_name 이 null 이면 비교조차 못 한다.
 *
 * 방법: Gemini 로 각 이름의 표준 영문(canonical) 키를 뽑아 통일 → 같은 canon 끼리 병합.
 *   "찰리 푸스" → "charlie puth", "Chalie Puth" → "charlie puth" (오타 교정), 둘 다 합쳐짐.
 *
 * 안전장치: 활성 아티스트(이벤트 보유)만 대상, canon 길이 3 미만/불명은 스킵.
 * keep = 이벤트 많은 쪽(FK 재지정 최소). apply=false 면 미리보기만.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { geminiText } from "@/lib/gemini";
import { mergeArtists } from "./merge";

interface Artist {
  id: string;
  name: string;
  events: number;
}

const BATCH = 30;

function parseCanon(raw: string, n: number): (string | null)[] {
  const out: (string | null)[] = Array(n).fill(null);
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return out;
  try {
    const arr = JSON.parse(m[0]) as Array<{ i: number; canon?: string }>;
    for (const it of arr) {
      const idx = it.i - 1;
      if (idx < 0 || idx >= n) continue;
      const c = (it.canon ?? "")
        .toLowerCase()
        .normalize("NFC")
        .replace(/[^a-z0-9가-힣]/g, "");
      if (c.length >= 3) out[idx] = c;
    }
  } catch {
    /* skip */
  }
  return out;
}

async function canonicalize(names: string[]): Promise<(string | null)[]> {
  const result: (string | null)[] = [];
  for (let i = 0; i < names.length; i += BATCH) {
    const chunk = names.slice(i, i + BATCH);
    const list = chunk.map((t, j) => `${j + 1}. ${t}`).join("\n");
    const prompt = `다음 음악 아티스트 이름들의 "표준 영문(로마자) 이름"을 뽑아라.
- 한글 표기는 로마자로 (예: "찰리 푸스" → "Charlie Puth", "방탄소년단" → "BTS").
- 오타는 교정 (예: "Chalie Puth" → "Charlie Puth").
- 같은 아티스트면 반드시 같은 표준명이 나오게 일관되게.
- 공연명·페스티벌명 등 사람이 아니면 canon 을 빈 문자열로.
JSON 배열로만: [{"i":1,"canon":"Charlie Puth"}, ...]
이름:
${list}`;
    try {
      const raw = await geminiText(prompt);
      result.push(...parseCanon(raw, chunk.length));
    } catch {
      result.push(...Array(chunk.length).fill(null));
    }
  }
  return result;
}

export async function aiDedupArtists(opts?: {
  maxItems?: number;
  apply?: boolean;
}): Promise<{
  clusters: Array<{ canon: string; keep: string; names: string[] }>;
  merged: number;
}> {
  const maxItems = opts?.maxItems ?? 400;
  const apply = opts?.apply ?? false;
  const db = createServiceRoleClient();

  // 활성 아티스트(이벤트 보유) 집계
  const counts = new Map<string, number>();
  for (let f = 0; ; f += 1000) {
    const { data } = await db
      .from("events")
      .select("artist_id")
      .not("artist_id", "is", null)
      .range(f, f + 999);
    if (!data?.length) break;
    for (const e of data as { artist_id: string }[])
      counts.set(e.artist_id, (counts.get(e.artist_id) ?? 0) + 1);
    if (data.length < 1000) break;
  }
  const ids = Array.from(counts.keys()).slice(0, maxItems);
  if (!ids.length) return { clusters: [], merged: 0 };

  const artists: Artist[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db
      .from("artists")
      .select("id,name")
      .in("id", ids.slice(i, i + 200));
    for (const a of (data ?? []) as { id: string; name: string }[])
      artists.push({ id: a.id, name: a.name, events: counts.get(a.id) ?? 0 });
  }

  const canons = await canonicalize(artists.map((a) => a.name));
  const byCanon = new Map<string, Artist[]>();
  artists.forEach((a, i) => {
    const c = canons[i];
    if (!c) return;
    (byCanon.get(c) ?? byCanon.set(c, []).get(c)!).push(a);
  });

  const clusters: Array<{ canon: string; keep: string; names: string[] }> = [];
  let merged = 0;
  for (const [canon, group] of Array.from(byCanon)) {
    if (group.length < 2) continue;
    // keep = 이벤트 많은 쪽
    const sorted = [...group].sort((a, b) => b.events - a.events);
    const keep = sorted[0];
    clusters.push({ canon, keep: keep.name, names: group.map((g) => g.name) });
    if (apply) {
      for (const m of sorted.slice(1)) {
        try {
          await mergeArtists({ keepId: keep.id, mergeId: m.id });
          merged++;
        } catch {
          /* skip on FK conflict */
        }
      }
    }
  }
  return { clusters, merged };
}
