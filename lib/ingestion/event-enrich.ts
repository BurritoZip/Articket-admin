/**
 * 이벤트 직접 보강 — 큐 없이 파이프라인에서 직접 호출
 * Gemini로 누락 필드 채우기
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { geminiText } from "@/lib/gemini";
import { matchOrCreateArtist } from "./artist-matcher";

const GENRES = ["뮤지컬", "콘서트", "연극", "전시", "무용", "클래식", "오페라", "축제", "기타"] as const;

async function predictGenre(title: string): Promise<string | null> {
  const prompt = `다음 공연 제목을 보고 장르를 하나만 선택하세요. 반드시 아래 목록 중 하나만 답변하세요.
장르 목록: ${GENRES.join(", ")}
공연 제목: "${title}"
답변 (장르 이름만):`;
  try {
    const raw = await geminiText(prompt);
    return GENRES.find((g) => raw.includes(g)) ?? null;
  } catch { return null; }
}

async function predictAgeRestriction(title: string): Promise<string | null> {
  const prompt = `다음 공연 제목을 보고 관람 연령 제한을 추론하세요. 반드시 다음 중 하나만 답변하세요: "전체관람가", "12세이상", "15세이상", "18세이상", "모름"
공연 제목: "${title}"
답변 (연령제한만):`;
  try {
    const raw = await geminiText(prompt);
    const options = ["전체관람가", "12세이상", "15세이상", "18세이상"];
    return options.find((o) => raw.includes(o)) ?? null;
  } catch { return null; }
}

async function extractArtistFromTitle(title: string): Promise<string | null> {
  const prompt = `다음 공연/콘서트 제목에서 주요 아티스트(가수/그룹) 이름만 추출하세요.
아티스트 이름이 없거나 확실하지 않으면 "없음"이라고만 답변하세요.
공연 제목: "${title}"
아티스트 이름만 (없으면 "없음"):`;
  try {
    const raw = await geminiText(prompt).then((s) => s.trim());
    if (!raw || raw === "없음" || raw.length > 60) return null;
    return raw.replace(/^["'\[({]|["'\])}]$/g, "").trim() || null;
  } catch { return null; }
}

/** 장르 없는 이벤트 직접 보강 */
export async function enrichEventGenres(maxItems = 50): Promise<{ filled: number }> {
  const db = createServiceRoleClient();
  const { data: events } = await db
    .from("events")
    .select("id,title")
    .is("genre", null)
    .limit(maxItems);

  let filled = 0;
  for (const event of events ?? []) {
    const genre = await predictGenre(event.title);
    if (genre) {
      await db.from("events").update({ genre }).eq("id", event.id);
      filled++;
    }
  }
  return { filled };
}

/** 연령제한 없는 이벤트 직접 보강 */
export async function enrichEventAges(maxItems = 50): Promise<{ filled: number }> {
  const db = createServiceRoleClient();
  const { data: events } = await db
    .from("events")
    .select("id,title")
    .is("age_restriction", null)
    .limit(maxItems);

  let filled = 0;
  for (const event of events ?? []) {
    const age = await predictAgeRestriction(event.title);
    if (age) {
      await db.from("events").update({ age_restriction: age }).eq("id", event.id);
      filled++;
    }
  }
  return { filled };
}

/** 아티스트 없는 이벤트 Gemini로 직접 연결 */
export async function enrichEventArtists(maxItems = 100): Promise<{ linked: number; skipped: number }> {
  const db = createServiceRoleClient();
  const { data: events } = await db
    .from("events")
    .select("id,title")
    .is("artist_id", null)
    .not("status", "eq", "ended")
    .order("start_date", { ascending: false })
    .limit(maxItems);

  let linked = 0;
  let skipped = 0;

  for (const event of events ?? []) {
    const artistName = await extractArtistFromTitle(event.title);
    if (!artistName) { skipped++; continue; }

    const artistId = await matchOrCreateArtist(artistName).catch(() => null);
    if (!artistId) { skipped++; continue; }

    await db.from("events").update({ artist_id: artistId }).eq("id", event.id);
    await db.from("event_artists").upsert(
      { event_id: event.id, artist_id: artistId, artist_name: artistName, role: "main", display_order: 1 },
      { onConflict: "event_id,artist_id", ignoreDuplicates: true },
    );
    linked++;
  }
  return { linked, skipped };
}
