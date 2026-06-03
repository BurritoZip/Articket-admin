/**
 * Gemini 그라운딩 아티스트 보강 — 브리틀한 HTTP 스크래핑(namu/melon/naver) 대체.
 *
 * 구글검색 그라운딩으로 실제 웹에서 아티스트 정보를 확인해 채운다.
 * description·occupation·country·name_en 등 텍스트 사실을 한 번에 가져온다.
 * 못 찾으면 null(환각 방지). 기존값은 덮어쓰지 않는다(force 제외).
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { geminiTextGrounded } from "@/lib/gemini";

interface GeminiArtistInfo {
  is_music_artist: boolean | null;
  name_en: string | null;
  occupation: string | null;
  country: string | null;
  description: string | null;
}

function parse(raw: string): GeminiArtistInfo | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const str = (v: unknown) =>
      typeof v === "string" && v.trim() && !/^null$/i.test(v.trim())
        ? v.trim()
        : null;
    return {
      is_music_artist:
        typeof o.is_music_artist === "boolean" ? o.is_music_artist : null,
      name_en: str(o.name_en),
      occupation: str(o.occupation),
      country: str(o.country),
      description: str(o.description),
    };
  } catch {
    return null;
  }
}

async function fetchOne(name: string): Promise<GeminiArtistInfo | null> {
  const prompt = `대중음악 아티스트 "${name}" 정보를 웹에서 찾아 JSON으로만 답하라.
{
  "is_music_artist": true/false,   // 가수·밴드·래퍼·아이돌·싱어송라이터면 true. 화가·배우·전시·작가 등이면 false
  "name_en": "영문 표기 또는 null",
  "occupation": "가수|밴드|래퍼|아이돌|싱어송라이터|DJ 중 하나 또는 null",
  "country": "국적(예: 대한민국, 미국, 일본) 또는 null",
  "description": "한국어 한 줄 소개(40자 이내) 또는 null"
}
확실하지 않으면 해당 값은 null. 추측 금지.`;
  try {
    return parse(await geminiTextGrounded(prompt));
  } catch {
    return null;
  }
}

export async function geminiEnrichArtists(opts?: {
  maxItems?: number;
  force?: boolean;
}): Promise<{ checked: number; filled: number; notMusic: number }> {
  const maxItems = opts?.maxItems ?? 60;
  const force = opts?.force ?? false;
  const db = createServiceRoleClient();

  // description 비어있는(=미보강) 아티스트 우선. 이벤트 보유 아티스트부터.
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

  let q = db
    .from("artists")
    .select("id,name,name_en,occupation,country,description");
  if (!force) q = q.is("description", null);
  const { data: artists } = await q.limit(2000);
  if (!artists?.length) return { checked: 0, filled: 0, notMusic: 0 };

  // 이벤트 많은 순 정렬 후 상한
  const sorted = [...artists].sort(
    (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0),
  );
  const target = sorted.slice(0, maxItems);

  let filled = 0;
  let notMusic = 0;
  for (const a of target) {
    const info = await fetchOne(a.name);
    if (!info) continue;
    if (info.is_music_artist === false) notMusic++;
    const patch: Record<string, string> = {};
    if (info.description) patch.description = info.description;
    if (info.occupation && (force || !a.occupation))
      patch.occupation = info.occupation;
    if (info.country && (force || !a.country)) patch.country = info.country;
    if (info.name_en && (force || !a.name_en)) patch.name_en = info.name_en;
    if (Object.keys(patch).length) {
      await db.from("artists").update(patch).eq("id", a.id);
      filled++;
    }
  }
  return { checked: target.length, filled, notMusic };
}
