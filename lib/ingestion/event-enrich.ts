/**
 * 이벤트 직접 보강 — 큐 없이 파이프라인에서 직접 호출
 * Gemini로 누락 필드 채우기
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { geminiText, geminiTextGrounded, GeminiQuotaError } from "@/lib/gemini";
import { matchOrCreateArtist } from "./artist-matcher";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "모델이 답했는데 정보가 없다"(= 재시도해도 같음)와 "호출 자체가 실패했다"(429·네트워크, =
 * 재시도하면 성공)를 구분한다.
 *
 * 왜 필요한가: 보강 함수들이 실패해도 `*_checked_at` 워터마크를 찍고 넘어갔다. 워터마크는
 * `.is(col, null)` 하드 게이트로 읽히므로 **한 번 실패 = 그 행은 영구히 재시도 대상에서 제외**였다.
 * 쿼터 서킷브레이커가 열리면 배치 40건이 한 번에 영구 소각됐다.
 */
type Attempt<T> = { ok: true; value: T } | { ok: false; quota: boolean };

async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, quota: e instanceof GeminiQuotaError };
  }
}

/**
 * 재보강 주기 — 마지막 시도(*_checked_at / enrich_attempted_at)가 이만큼 지난 활성 공연은
 * 다시 보강 대상에 넣는다. 한번 시도하면 영원히 제외하던 걸 "주기적 최신화"로 바꾸는 워터마크.
 * 제목만으로 결정되는 장르·연령은 재보강해도 결과가 같아 1회성 유지(토큰 절약).
 */
export const REENRICH_STALE_DAYS = 7;

/** "col IS NULL OR col < (now - staleDays)" PostgREST or-필터 문자열 */
function staleGate(col: string, staleDays = REENRICH_STALE_DAYS): string {
  const cutoff = new Date(
    Date.now() - staleDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  return `${col}.is.null,${col}.lt.${cutoff}`;
}

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
    .or(staleGate("ticket_checked_at")) // 미시도 or REENRICH_STALE_DAYS 지난 건 재그라운딩(예매일 갱신)
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

// Articket = 대중음악 전용. 뮤지컬·연극·전시·무용·클래식·오페라 등 비음악 라벨 제외.
const GENRES = ["콘서트", "축제", "기타"] as const;

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
  // 호출 실패는 삼키지 않고 던진다 — 호출부가 "모름"과 구분해 워터마크를 찍을지 정한다.
  const raw = await geminiText(prompt);
  const options = ["전체관람가", "12세이상", "15세이상", "18세이상"];
  return options.find((o) => raw.includes(o)) ?? null;
}

/** 페스티벌·다중 출연·티켓단계 제목 — 단일 아티스트 추출 부적합 (라인업으로 표현) */
const MULTI_ARTIST_RE =
  /페스티벌|페스타|페스트|festival|fest['’\s]|워터밤|펜타포트|락\s?페|록\s?페스|라인업|line[\s-]?up|헤드라이너|얼리버드|블라인드|pre[\s-]?sale|premium\s?pass|컨퍼런스|conference|박람회|expo|엑스포/i;

/** source_urls(문자열/{url} 혼용) 에서 URL 문자열만 뽑는다 */
function extractSourceUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const urls: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && /^https?:\/\//.test(item)) urls.push(item);
    else if (
      item &&
      typeof item === "object" &&
      typeof (item as { url?: unknown }).url === "string" &&
      /^https?:\/\//.test((item as { url: string }).url)
    ) {
      urls.push((item as { url: string }).url);
    }
  }
  return urls;
}

/** HTML → 대략적 텍스트 (Gemini 컨텍스트용, 태그/스크립트 제거) */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`lineup_http_${res.status}`);
  return htmlToText(await res.text());
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * 원본 상세페이지의 og:description / meta description.
 * Gemini 를 쓰지 않는 무료·결정론적 설명 경로 — 그라운딩 호출 전에 먼저 시도한다.
 */
async function fetchMetaDescription(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const pick = (re: RegExp): string | null => html.match(re)?.[1] ?? null;
    const raw =
      // content 가 property 앞/뒤 어느 쪽에 오든 잡는다
      pick(
        /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']{10,})["']/i,
      ) ??
      pick(
        /<meta[^>]+content=["']([^"']{10,})["'][^>]*property=["']og:description["']/i,
      ) ??
      pick(
        /<meta[^>]+name=["']description["'][^>]*content=["']([^"']{10,})["']/i,
      );
    if (!raw) return null;
    const text = raw
      .replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
      .replace(/\s+/g, " ")
      .trim();
    // 너무 짧으면 사이트 공통 문구일 가능성이 커 버린다
    return text.length >= 20 ? text.slice(0, 500) : null;
  } catch {
    return null;
  }
}

type FestivalEvent = {
  id: string;
  title: string;
  start_date: string | null;
  source_urls: unknown;
};

/**
 * 페스티벌 라인업 전체 수집 — 두 소스를 합쳐 누락을 줄인다:
 *  1. source_urls(예매 페이지)를 재fetch 해 페이지 텍스트를 Gemini 에 컨텍스트로 제공.
 *  2. Google 검색 그라운딩으로 웹에서 라인업을 교차 확인.
 * 확실치 않은 이름은 버린다(환각 방지). 최대 150명.
 */
async function collectFestivalLineup(event: FestivalEvent): Promise<string[]> {
  const urls = extractSourceUrls(event.source_urls).slice(0, 3);
  let pageText = "";
  for (const url of urls) {
    try {
      pageText += " " + (await fetchPageText(url)).slice(0, 6000);
    } catch {
      /* 개별 URL 실패는 무시 — 나머지/검색으로 보완 */
    }
  }

  const day = event.start_date ? String(event.start_date).slice(0, 10) : "미상";
  const prompt = `다음 페스티벌/다중출연 공연에 "실제 출연하는" 아티스트(가수/밴드/그룹) 이름을 빠짐없이 모두 찾아라.
Google 검색으로 공식 라인업을 확인하고, 아래 예매 페이지 텍스트도 함께 참고하라.
공연명: "${event.title}"
공연일자(참고): ${day}
${pageText ? `예매 페이지 텍스트(참고, 일부):\n${pageText.slice(0, 12000)}` : ""}

규칙:
- 사람/그룹 이름만. 공연명·페스티벌명·스테이지명·주최사·투어명·회차·티켓등급은 제외.
- 실제 출연이 확인되는 아티스트만. 확실하지 않으면 넣지 마라(추측·환각 금지).
- 최대한 많이. 헤드라이너뿐 아니라 서브/신인 라인업까지.
JSON만 답해: {"artists":["이름1","이름2", ...]}`;

  try {
    const raw = await geminiTextGrounded(prompt);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]) as { artists?: unknown };
    if (!Array.isArray(parsed.artists)) return [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const a of parsed.artists) {
      if (typeof a !== "string") continue;
      const nm = a.replace(/^["'\[({]|["'\])}]$/g, "").trim();
      const key = nm.toLowerCase();
      if (
        nm &&
        nm.length <= 40 &&
        !seen.has(key) &&
        !/아티스트|라인업|line[\s-]?up|없음|미정|tba/i.test(nm)
      ) {
        seen.add(key);
        names.push(nm);
      }
    }
    return names.slice(0, 150);
  } catch {
    return [];
  }
}

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

/**
 * 설명(notice_text) 없는 이벤트 보강 — Google 검색 그라운딩으로 공연 소개 확보.
 *
 * 배경: melon/interpark/yes24 는 목록만 긁어 설명이 비어 들어온다(상세 CSR/봇차단).
 * 유저 노출 설명 컬럼은 events.notice_text(iOS EventRow.noticeText). 그라운딩으로
 * 실제 공연 정보를 요약해 채운다. 환각 방지 — 확실치 않으면 비운다.
 * 대상: 종료 안 된 이벤트 중 notice_text 미상 + 미시도(description_checked_at NULL).
 *
 * 비용: 그라운딩 호출은 요청당 과금되는데 이 경로의 충전율은 8% 수준이었다(40콜/실행 = 월 2,400).
 * 그래서 **원본 상세페이지의 og:description 을 먼저 본다** — 무료·결정론적이고, 예매처가 직접
 * 쓴 소개라 품질도 더 낫다. 실패한 건만 그라운딩으로 폴백한다.
 */
export async function enrichEventDescriptions(
  maxItems = 40,
): Promise<{ filled: number; checked: number; fromMeta: number }> {
  const db = createServiceRoleClient();
  const { data: events } = await db
    .from("events")
    .select("id,title,start_date,source_urls,booking_url")
    .or("notice_text.is.null,notice_text.eq.")
    .is("description_checked_at", null) // 1회성 — 못 찾아도 재시도 안 함(토큰 절약)
    .not("status", "eq", "ended")
    .order("start_date", { ascending: true })
    .limit(maxItems);

  const now = new Date().toISOString();
  let filled = 0;
  let checked = 0;
  let fromMeta = 0;
  for (const e of events ?? []) {
    checked++;

    // 1순위: 원본 페이지 메타 설명(무료)
    const urls = [
      ...extractSourceUrls(e.source_urls),
      typeof e.booking_url === "string" ? e.booking_url : "",
    ].filter(Boolean);
    let meta: string | null = null;
    for (const u of urls) {
      meta = await fetchMetaDescription(u);
      if (meta) break;
    }
    if (meta) {
      await db
        .from("events")
        .update({ notice_text: meta, description_checked_at: now })
        .eq("id", e.id);
      filled++;
      fromMeta++;
      continue; // Gemini 호출 안 함
    }

    // 2순위: 그라운딩 폴백
    const day = e.start_date ? String(e.start_date).slice(0, 10) : "미상";
    const prompt = `다음 공연/콘서트/페스티벌의 공식 소개를 2~4문장으로 요약하라.
Google 검색으로 실제 정보를 확인하고, 어떤 공연인지·주요 출연/특징·성격이 드러나게 써라.
공연명: "${e.title}"
공연일자(참고): ${day}
규칙: 사실만. 확실하지 않으면 지어내지 말 것. 정보가 거의 없으면 정확히 "없음"이라고만 답하라.
홍보 문구·이모지·해시태그 없이 담백하게. 250자 이내.`;
    const r = await attempt(() =>
      geminiTextGrounded(prompt).then((s) => s.trim()),
    );
    if (!r.ok) {
      // 그라운딩 호출 실패 — checked_at 을 찍지 않는다. 찍으면 영구 포기가 된다.
      checked--;
      if (r.quota) break; // 서킷 열림: 남은 배치도 전부 실패한다
      continue;
    }
    const patch: Record<string, string> = { description_checked_at: now };
    const raw = r.value;
    if (
      raw &&
      !/^없음$|정보가 (거의 )?없|확실하지/.test(raw) &&
      raw.length >= 10
    ) {
      patch.notice_text = raw.slice(0, 500);
      filled++;
    }
    await db.from("events").update(patch).eq("id", e.id);
  }
  return { filled, checked, fromMeta };
}

/**
 * 표지(poster_url) 없는 이벤트 보강 — interpark 예매 URL 이 있으면 ticketimage CDN 에서
 * 포스터를 결정적으로 구성한다.
 *
 * interpark 포스터 URL 패턴(검증됨): ticketimage.interpark.com/Play/image/large/{code앞2}/{code}_p.gif
 * 구성한 URL 을 실제 fetch 해 이미지인지 검증한 뒤에만 저장(깨진/없는 이미지 방지).
 * interpark URL 이 없는 건은 admin '표지 없음' 필터 + 업로더로 수동 처리.
 */
function interparkPosterUrl(goodsCode: string): string {
  return `https://ticketimage.interpark.com/Play/image/large/${goodsCode.slice(0, 2)}/${goodsCode}_p.gif`;
}

async function isReachableImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return (
      res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")
    );
  } catch {
    return false;
  }
}

export async function backfillEventPosters(
  maxItems = 40,
): Promise<{ filled: number; checked: number }> {
  const db = createServiceRoleClient();
  const { data: events } = await db
    .from("events")
    .select("id,source_urls,booking_url")
    .is("poster_url", null)
    // 1회성 하드 게이트였다 → staleGate. 이 경로는 Gemini 를 쓰지 않아(정규식 + HEAD 성격의 fetch)
    // 재시도 비용이 사실상 0인데, 한 번 실패하면 영원히 포스터를 못 얻는 상태로 굳었다.
    .or(staleGate("poster_checked_at"))
    .not("status", "eq", "ended")
    .limit(maxItems);

  const now = new Date().toISOString();
  const goodsRe = /interpark\.com\/goods\/(\d+)/i;
  let filled = 0;
  let checked = 0;
  for (const e of events ?? []) {
    checked++;
    const urls = [
      ...extractSourceUrls(e.source_urls),
      typeof e.booking_url === "string" ? e.booking_url : "",
    ].filter(Boolean);
    const match = urls.map((u) => u.match(goodsRe)).find(Boolean);
    const patch: Record<string, string> = { poster_checked_at: now };
    if (match) {
      const candidate = interparkPosterUrl(match[1]);
      if (await isReachableImage(candidate)) {
        patch.poster_url = candidate;
        filled++;
      }
    }
    await db.from("events").update(patch).eq("id", e.id);
  }
  return { filled, checked };
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
    const r = await attempt(() => predictAgeRestriction(event.title));
    if (!r.ok) {
      // 호출 실패 — 워터마크를 찍지 않아 다음 실행에서 다시 시도된다.
      if (r.quota) break; // 서킷 열림: 남은 건도 전부 실패한다
      continue;
    }
    const patch: Record<string, string> = { age_checked_at: now };
    if (r.value) {
      patch.age_restriction = r.value;
      filled++;
    }
    await db.from("events").update(patch).eq("id", event.id);
  }
  return { filled };
}

/**
 * 아티스트 없는 이벤트 Gemini로 직접 연결.
 *
 * - 미시도(enrich_attempted_at IS NULL) + REENRICH_STALE_DAYS 지난 건 선택 → 백로그 드레인 + 주기적 재매칭.
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
    .select("id,title,start_date,source_urls")
    .is("artist_id", null)
    .or(staleGate("enrich_attempted_at")) // 미시도 or REENRICH_STALE_DAYS 지난 건 재시도(DB 성장분 재매칭)
    .not("status", "eq", "ended")
    .order("start_date", { ascending: false })
    .limit(maxItems);

  const now = new Date().toISOString();
  let linked = 0;
  let multiArtist = 0;
  let noArtist = 0;

  for (const event of events ?? []) {
    // 1) 페스티벌/다중 출연 → 라인업 전체를 실제로 수집(재스크래핑 + 검색)해 event_artists 에 연결.
    //    단일 artist_id 는 없지만(multi_artist) 라인업은 채운다.
    if (MULTI_ARTIST_RE.test(event.title)) {
      const lineup = await collectFestivalLineup(event as FestivalEvent);
      const matched: { id: string; name: string }[] = [];
      for (const nm of lineup) {
        const id = await matchOrCreateArtist(nm).catch(() => null);
        if (id && !matched.some((m) => m.id === id))
          matched.push({ id, name: nm });
      }
      if (matched.length > 0) {
        await db.from("event_artists").upsert(
          matched.map((m, i) => ({
            event_id: event.id,
            artist_id: m.id,
            artist_name: m.name,
            role: "lineup",
            display_order: i + 1,
          })),
          { onConflict: "event_id,artist_id", ignoreDuplicates: true },
        );
      }
      await db
        .from("events")
        .update({
          artist_link_status: "multi_artist",
          enrich_attempted_at: now,
          lineup_checked_at: now,
          lineup_count: matched.length,
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
