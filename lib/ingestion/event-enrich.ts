/**
 * 이벤트 직접 보강 — 큐 없이 파이프라인에서 직접 호출
 * Gemini로 누락 필드 채우기
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { geminiText, geminiTextGrounded } from "@/lib/gemini";
import { matchOrCreateArtist } from "./artist-matcher";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" 형태이고 실제 유효한 날짜만 통과, 아니면 null */
function cleanDate(v: unknown): string | null {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return null;
  return isNaN(Date.parse(v)) ? null : v;
}

/**
 * 예매일자 보강 — 구글검색 그라운딩으로 예매오픈/마감일을 실제 웹에서 확인.
 * 공연일자(start/end)와 혼동하지 않도록 명시적으로 "예매" 날짜만 요청한다.
 * 못 찾으면 null 반환 → 가짜 날짜 안 박는다(환각 방지).
 *
 * 대상: 종료 안 된 이벤트 중 ticket_open_date 미상.
 */
export async function enrichEventTicketDates(
  maxItems = 200,
): Promise<{ filled: number; checked: number }> {
  const db = createServiceRoleClient();
  const { data: events } = await db
    .from("events")
    .select("id,title,start_date,ticket_provider,venue_id")
    .neq("status", "ended")
    .is("ticket_open_date", null)
    .is("ticket_checked_at", null) // 이미 시도한 건 재그라운딩 안 함(토큰 절약)
    .order("start_date", { ascending: true })
    .limit(maxItems);

  const now = new Date().toISOString();
  let filled = 0;
  let checked = 0;
  for (const e of events ?? []) {
    checked++;
    const day = e.start_date ? String(e.start_date).slice(0, 10) : "미상";
    const prompt = `다음 공연의 "예매(티켓) 오픈일"과 "예매 마감일"을 웹에서 찾아라.
주의: 공연일자가 아니라 "예매가 시작/종료되는 날짜"다. 둘은 다르다.
공연명: "${e.title}"
공연일자(참고): ${day}
${e.ticket_provider ? `예매처: ${e.ticket_provider}` : ""}
확실하지 않으면 반드시 null. 추측 금지.
JSON만 답해: {"ticket_open_date":"YYYY-MM-DD 또는 null","ticket_close_date":"YYYY-MM-DD 또는 null"}`;
    // 시도 기록은 항상 남긴다(못 찾아도) → 다음 실행에서 재그라운딩 방지.
    const patch: Record<string, string> = { ticket_checked_at: now };
    try {
      const raw = await geminiTextGrounded(prompt);
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as Record<string, unknown>;
        const open = cleanDate(parsed.ticket_open_date);
        const close = cleanDate(parsed.ticket_close_date);
        if (open) patch.ticket_open_date = `${open}T00:00:00+00:00`;
        if (close) patch.ticket_close_date = `${close}T23:59:59+00:00`;
        if (open || close) filled++;
      }
    } catch {
      /* 그라운딩 실패 — checked_at만 기록하고 넘어감 */
    }
    await db.from("events").update(patch).eq("id", e.id);
  }
  return { filled, checked };
}

const GENRES = [
  "뮤지컬",
  "콘서트",
  "연극",
  "전시",
  "무용",
  "클래식",
  "오페라",
  "축제",
  "기타",
] as const;

async function predictGenre(title: string): Promise<string | null> {
  const prompt = `다음 공연 제목을 보고 장르를 하나만 선택하세요. 반드시 아래 목록 중 하나만 답변하세요.
장르 목록: ${GENRES.join(", ")}
공연 제목: "${title}"
답변 (장르 이름만):`;
  try {
    const raw = await geminiText(prompt);
    return GENRES.find((g) => raw.includes(g)) ?? null;
  } catch {
    return null;
  }
}

async function predictAgeRestriction(title: string): Promise<string | null> {
  const prompt = `다음 공연 제목을 보고 관람 연령 제한을 추론하세요. 반드시 다음 중 하나만 답변하세요: "전체관람가", "12세이상", "15세이상", "18세이상", "모름"
공연 제목: "${title}"
답변 (연령제한만):`;
  try {
    const raw = await geminiText(prompt);
    const options = ["전체관람가", "12세이상", "15세이상", "18세이상"];
    return options.find((o) => raw.includes(o)) ?? null;
  } catch {
    return null;
  }
}

/** 페스티벌·다중 출연·티켓단계 제목 — 단일 아티스트 추출 부적합 (라인업으로 표현) */
const MULTI_ARTIST_RE =
  /페스티벌|페스타|페스트|festival|fest['’\s]|워터밤|펜타포트|락\s?페|록\s?페스|라인업|line[\s-]?up|헤드라이너|얼리버드|블라인드|pre[\s-]?sale|premium\s?pass|컨퍼런스|conference|박람회|expo|엑스포/i;

/**
 * 제목에서 출연 아티스트를 모두 추출(복수).
 * "선우정아 X 적재", "자우림, 로맨틱펀치" 처럼 합동공연이면 개별로 분리한다.
 * 합쳐진 단일 레코드는 만들지 않는다 — 아티스트는 항상 개별.
 */
async function extractArtistsFromTitle(title: string): Promise<string[]> {
  const prompt = `다음 공연/콘서트 제목에 출연하는 아티스트(가수/그룹) 이름을 모두 추출해 쉼표로 구분해 나열하세요.
규칙:
- 사람/그룹 이름만. 공연명·페스티벌명·프로그램명·투어명·회차는 제외.
- "A X B", "A & B", "A, B", "A feat B" 처럼 여러 명이면 각각 분리해서 나열.
- 아티스트가 없으면 정확히 "없음"이라고만 답하세요.
공연 제목: "${title}"`;
  try {
    const raw = await geminiText(prompt).then((s) => s.trim());
    if (!raw || /없음|모름|확실하지/.test(raw)) return [];
    return raw
      .split(/[,、]/)
      .map((s) => s.replace(/^["'\[({]|["'\])}]$/g, "").trim())
      .filter((s) => s && s.length <= 40 && !/아티스트 이름|추출|없음/.test(s));
  } catch {
    return [];
  }
}

/** 장르 없는 이벤트 직접 보강 */
export async function enrichEventGenres(
  maxItems = 50,
): Promise<{ filled: number }> {
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
export async function enrichEventAges(
  maxItems = 50,
): Promise<{ filled: number }> {
  const db = createServiceRoleClient();
  const { data: events } = await db
    .from("events")
    .select("id,title")
    .is("age_restriction", null)
    .is("age_checked_at", null) // 이미 시도한 건 재호출 안 함(토큰 절약)
    .limit(maxItems);

  const now = new Date().toISOString();
  let filled = 0;
  for (const event of events ?? []) {
    const age = await predictAgeRestriction(event.title);
    const patch: Record<string, string> = { age_checked_at: now };
    if (age) {
      patch.age_restriction = age;
      filled++;
    }
    await db.from("events").update(patch).eq("id", event.id);
  }
  return { filled };
}

/**
 * 아티스트 없는 이벤트 Gemini로 직접 연결.
 *
 * - 아직 시도 안 한 이벤트(enrich_attempted_at IS NULL)만 선택 → 매 run 다음 배치로 진행(백로그 드레인).
 * - 페스티벌/다중 출연 제목은 'multi_artist'로 분류 (단일 artist_id 없는 게 정상, 라인업으로 표현).
 * - 개별 공연인데 추출 불가 → 'no_artist' 마킹 (재선택 방지, 진짜 미흡으로 집계).
 */
export async function enrichEventArtists(maxItems = 100): Promise<{
  linked: number;
  multiArtist: number;
  noArtist: number;
  skipped: number;
}> {
  const db = createServiceRoleClient();
  const { data: events } = await db
    .from("events")
    .select("id,title")
    .is("artist_id", null)
    .is("enrich_attempted_at", null) // 재선택 방지 — 시도한 건 제외
    .not("status", "eq", "ended")
    .order("start_date", { ascending: false })
    .limit(maxItems);

  const now = new Date().toISOString();
  let linked = 0;
  let multiArtist = 0;
  let noArtist = 0;

  for (const event of events ?? []) {
    // 1) 페스티벌/다중 출연 → multi_artist 분류, 단일 추출 스킵
    if (MULTI_ARTIST_RE.test(event.title)) {
      await db
        .from("events")
        .update({
          artist_link_status: "multi_artist",
          enrich_attempted_at: now,
        })
        .eq("id", event.id);
      multiArtist++;
      continue;
    }

    // 2) 개별/합동 공연 → 제목에서 출연 아티스트 모두 추출(복수)
    const names = await extractArtistsFromTitle(event.title);
    const matched: { id: string; name: string }[] = [];
    for (const nm of names) {
      const id = await matchOrCreateArtist(nm).catch(() => null);
      if (id && !matched.some((m) => m.id === id))
        matched.push({ id, name: nm });
    }

    if (matched.length === 0) {
      await db
        .from("events")
        .update({ artist_link_status: "no_artist", enrich_attempted_at: now })
        .eq("id", event.id);
      noArtist++;
      continue;
    }

    // 대표 artist_id = 첫 번째, 나머지는 event_artists에 라인업으로 다중 연결
    await db
      .from("events")
      .update({
        artist_id: matched[0].id,
        artist_link_status: "linked",
        enrich_attempted_at: now,
      })
      .eq("id", event.id);
    await db.from("event_artists").upsert(
      matched.map((m, i) => ({
        event_id: event.id,
        artist_id: m.id,
        artist_name: m.name,
        role: i === 0 ? "main" : "lineup",
        display_order: i + 1,
      })),
      { onConflict: "event_id,artist_id", ignoreDuplicates: true },
    );
    linked++;
  }
  return { linked, multiArtist, noArtist, skipped: noArtist };
}
