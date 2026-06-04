/**
 * 아티스트 중복 병합 — 저장된 gemini_canon(표준명) 기준. **Gemini 호출 없음(토큰 0).**
 *
 * canon 은 geminiEnrichArtists 가 아티스트당 1콜로 채워 artists.gemini_canon 에 저장한다.
 * 여기선 그 저장값으로 그룹핑만 → "찰리 푸스"/"Charlie Puth"/"Chalie Puth"가 같은 canon 으로 묶여 병합.
 * 매 파이프라인 실행마다 돌아도 Gemini 비용이 들지 않는다(이전엔 활성 아티스트 전체를 매번 재호출).
 *
 * keep = 이벤트 많은 쪽(FK 재지정 최소). apply=false 면 미리보기만.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mergeArtists } from "./merge";

interface Artist {
  id: string;
  name: string;
  canon: string;
  events: number;
}

export async function aiDedupArtists(opts?: {
  apply?: boolean;
}): Promise<{
  clusters: Array<{ canon: string; keep: string; names: string[] }>;
  merged: number;
}> {
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

  // canon 이 있는 아티스트만 로드(이벤트 보유분 우선)
  const artists: Artist[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await db
      .from("artists")
      .select("id,name,gemini_canon")
      .not("gemini_canon", "is", null)
      .range(f, f + 999);
    if (!data?.length) break;
    for (const a of data as {
      id: string;
      name: string;
      gemini_canon: string;
    }[]) {
      if (a.gemini_canon.length < 3) continue;
      artists.push({
        id: a.id,
        name: a.name,
        canon: a.gemini_canon,
        events: counts.get(a.id) ?? 0,
      });
    }
    if (data.length < 1000) break;
  }

  const byCanon = new Map<string, Artist[]>();
  for (const a of artists)
    (byCanon.get(a.canon) ?? byCanon.set(a.canon, []).get(a.canon)!).push(a);

  const clusters: Array<{ canon: string; keep: string; names: string[] }> = [];
  let merged = 0;
  for (const [canon, group] of Array.from(byCanon)) {
    if (group.length < 2) continue;
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
