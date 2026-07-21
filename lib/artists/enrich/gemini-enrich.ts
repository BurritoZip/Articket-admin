/**
 * Gemini 그라운딩 아티스트 보강 (통합) — 브리틀한 HTTP 스크래핑 대체 + 토큰 절약.
 *
 * 아티스트당 Gemini 1콜로 정보 + 표준명(canonical)을 동시에 가져온다.
 *   - 정보: description/occupation/country/name_en (없으면 null, 환각 방지)
 *   - canonical: 한/영·오타 통일한 표준 영문 키 → artists.gemini_canon 저장 →
 *     dedup(aiDedupArtists)이 Gemini 없이 이 키로 그룹핑.
 * gemini_checked_at 마커로 한 번만 호출(모델이 "정보 없음"으로 답한 경우도 재호출 안 함).
 * 단 **호출 자체가 실패한 건은 마킹하지 않는다** — 429 한 번에 배치 전체가 영구 소각되던 원인.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { geminiTextGrounded, GeminiQuotaError } from "@/lib/gemini";

interface GeminiArtistInfo {
  is_music_artist: boolean | null;
  canonical: string | null; // 표준 영문명(원문)
  name_en: string | null;
  occupation: string | null;
  country: string | null;
  description: string | null;
}

/** canonical 표준 키 — 비교/그룹핑용 (영숫자+한글만) */
export function canonKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9가-힣]/g, "");
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
      canonical: str(o.canonical_name),
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
  "canonical_name": "표준 영문(로마자) 이름 — 같은 아티스트면 항상 동일하게(예: 찰리 푸스/Chalie Puth → Charlie Puth)",
  "name_en": "영문 표기 또는 null",
  "occupation": "가수|밴드|래퍼|아이돌|싱어송라이터|DJ 중 하나 또는 null",
  "country": "국적(예: 대한민국, 미국, 일본) 또는 null",
  "description": "한국어 한 줄 소개(40자 이내, 예: '솔로 발라드 가수') 또는 null"
}
확실하지 않으면 해당 값은 null. 추측 금지.`;
  // 호출 실패는 던진다 — 호출부가 "정보 없음"과 구분해 gemini_checked_at 을 찍을지 정한다.
  // 삼키면 429 한 번에 배치 전체가 영구 재시도 불가 상태로 굳는다.
  return parse(await geminiTextGrounded(prompt));
}

export async function geminiEnrichArtists(opts?: {
  maxItems?: number;
  force?: boolean;
}): Promise<{ checked: number; filled: number; notMusic: number }> {
  const maxItems = opts?.maxItems ?? 60;
  const force = opts?.force ?? false;
  const db = createServiceRoleClient();

  // 이벤트 보유(활성) 아티스트 우선
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

  let q = db.from("artists").select("id,name,name_en,occupation,country");
  if (!force) q = q.is("gemini_checked_at", null); // 한 번만 — 재호출 방지(토큰 절약)
  const { data: artists } = await q.limit(2000);
  if (!artists?.length) return { checked: 0, filled: 0, notMusic: 0 };

  // 활성(이벤트 보유) 아티스트만 — 비활성(0건)은 노출 안 되니 토큰 낭비 방지
  const sorted = artists
    .filter((a) => (counts.get(a.id) ?? 0) > 0)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  const target = sorted.slice(0, maxItems);

  const now = new Date().toISOString();
  let filled = 0;
  let notMusic = 0;
  let checked = 0;
  for (const a of target) {
    let info: GeminiArtistInfo | null;
    try {
      info = await fetchOne(a.name);
    } catch (e) {
      // 호출 실패(429·네트워크) — 워터마크를 찍지 않아 다음 실행에서 재시도된다.
      if (e instanceof GeminiQuotaError) break; // 서킷 열림: 남은 건도 전부 실패
      continue;
    }
    checked++;
    // 모델이 답했으면(정보 없음 포함) 시도 기록 — 재호출 안 함
    const patch: Record<string, string | boolean> = { gemini_checked_at: now };
    if (info) {
      if (info.is_music_artist !== null)
        patch.is_music_artist = info.is_music_artist;
      if (info.is_music_artist === false) notMusic++;
      if (info.canonical) patch.gemini_canon = canonKey(info.canonical);
      if (info.description) patch.description = info.description;
      if (info.occupation && (force || !a.occupation))
        patch.occupation = info.occupation;
      if (info.country && (force || !a.country)) patch.country = info.country;
      if (info.name_en && (force || !a.name_en)) patch.name_en = info.name_en;
      if (Object.keys(patch).length > 1) filled++;
    }
    await db.from("artists").update(patch).eq("id", a.id);
  }
  return { checked, filled, notMusic };
}
