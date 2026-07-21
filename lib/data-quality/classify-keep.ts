/**
 * 공연 분류 — "남길 것 vs 지울 것"
 *
 * 정책(운영자 결정): **오로지 가수/밴드의 콘서트 + 음악 페스티벌만 남긴다.**
 * 그 외(뮤지컬·연극·클래식/오케스트라·오페라·발레·무용·전시·미술·강연·키즈 등)는 전부 제거 대상.
 *
 * Gemini 배치 분류 — 제목 여러 개를 한 번에 판별해 호출 수를 줄인다.
 * 불확실/파싱실패는 KEEP 으로 처리(삭제는 되돌릴 수 없으므로 보수적으로).
 *
 * 판정은 `title_keep_verdicts` 에 영속 캐시된다. 이 함수는 5개 스크래퍼와 purge 에서 매 실행
 * 호출되는데, 크롤 목록은 실행마다 거의 같아 캐시 없이는 같은 제목을 매번 다시 사왔다
 * (실행당 ~42 콜 = non-grounded 호출의 대부분). 제목→판정은 시간이 지나도 변하지 않으므로
 * 캐시 만료가 필요 없다.
 */
import { geminiText } from "@/lib/gemini";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * keep = 노출, drop = 제외.
 * unknown = **판정 못 함**(Gemini 호출 실패 — 429/네트워크). keep 도 drop 도 아니다.
 *   호출부는 unknown 을 "일단 숨기고 나중에 재판정"으로 다뤄야 한다. keep 으로 폴백하면
 *   외부 API 장애가 곧바로 품질 게이트를 열어 비음악(전시·토크·지역축제)이 앱에 뜬다.
 */
export type KeepVerdict = "keep" | "drop" | "unknown";

const BATCH = 25;
/** PostgREST .in() 한 번에 넣을 키 수 — URL 길이 한계 회피 */
const LOOKUP_CHUNK = 200;

/** 캐시 키 — 표기 차이(전각/공백/기호)를 흡수해 적중률을 올린다 */
function titleKey(t: string): string {
  return (t ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, "");
}

function buildPrompt(titles: string[]): string {
  const list = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  return `너는 공연 분류기다. 각 항목이 "대중음악 가수/밴드의 콘서트" 또는 "음악 페스티벌"인지 판별하라.

KEEP = 가수·밴드·아이돌·래퍼·싱어송라이터의 콘서트, 내한공연, 단독/합동 라이브, 음악 페스티벌·페스타·락페·재즈공연.
  - 인디·언더그라운드 아티스트 공연도 음악 공연이면 KEEP.
  - 제목에 사람 이름(한국어/영어 포함)이 있고 콘서트·라이브·공연 형식이면 KEEP.
  - "콘서트"·"라이브"·"투어"·"쇼"·"페스티벌"·"내한"·"단독공연"·"합동공연" 등 음악 공연 키워드가 있으면 KEEP.

DROP = 아래에 해당하는 것만:
  - 미술·회화·조각·사진·설치미술 전시 (화가 이름 전시: 르누아르·모네·피카소·고야·고흐·마티스 등).
  - 갤러리·박물관·뮤지엄·비엔날레·아트페어·내셔널지오그래픽·다큐·과학관·수족관.
  - 뮤지컬·연극·오페라·발레·무용·합창단·국악·오케스트라 연주회·클래식 리사이틀.
  - 강연·토크쇼·북콘서트·인문학·키즈·어린이 행사·박람회.
  - 배우·드라마배우·유튜버·크리에이터의 팬미팅/Fanmeeting (변우석·손석구 등 음악이 주업이 아닌 인물).
  - **음악이 주가 아닌 축제/행사**: 지역축제·문화제·민속축제·향토/전통 행사, 종교·불교·사찰·소원성취·기원제·제례, 먹거리·음식·맥주·와인·커피 축제, 꽃·벚꽃·장미·튤립 축제, 불꽃축제(불꽃놀이), 빛/등불 축제, 한류/관광 박람회, 지자체 홍보행사. (예: "경산갓바위소원성취축제", "○○문화제", "○○음식축제")
  - 제목이 쓰레기 텍스트(공지 + 공백/탭만 있음)인 것.

판단 기준:
  - 비음악 키워드(전시·미술·연극·오페라 등)가 명확히 있으면 DROP.
  - "축제/페스티벌"이라도 가수·밴드의 라이브 무대가 주가 아니라 지역·전통·종교·먹거리·꽃·불꽃 행사면 DROP. "음악 페스티벌/락페/재즈페스티벌"처럼 음악이 핵심일 때만 KEEP.
  - 아티스트 이름이 모호해도 음악 공연 형식이 맞으면 KEEP.
  - "팬미팅"·"Fanmeeting"은 가수·아이돌이면 KEEP, 배우·배우 겸 가수·드라마 주연이면 DROP.
  - 불확실하면 KEEP (삭제는 되돌릴 수 없음).

반드시 JSON 배열로만 답하라(설명 금지): [{"i":1,"v":"KEEP"},{"i":2,"v":"DROP"}, ...]

목록:
${list}`;
}

function parseVerdicts(raw: string, n: number): KeepVerdict[] {
  // 기본값 keep (보수적)
  const out: KeepVerdict[] = Array(n).fill("keep");
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return out;
  try {
    const arr = JSON.parse(match[0]) as Array<{ i: number; v: string }>;
    for (const item of arr) {
      const idx = item.i - 1;
      if (idx >= 0 && idx < n && /drop/i.test(item.v)) out[idx] = "drop";
    }
  } catch {
    /* 파싱 실패 → 전부 keep 유지 */
  }
  return out;
}

/** 캐시된 판정 조회 — 조회 실패는 캐시 미스로 간주(분류는 계속 진행) */
async function loadCached(keys: string[]): Promise<Map<string, KeepVerdict>> {
  const hit = new Map<string, KeepVerdict>();
  if (!keys.length) return hit;
  const db = createServiceRoleClient();
  for (let i = 0; i < keys.length; i += LOOKUP_CHUNK) {
    const { data } = await db
      .from("title_keep_verdicts")
      .select("title_key,verdict")
      .in("title_key", keys.slice(i, i + LOOKUP_CHUNK));
    for (const r of data ?? [])
      hit.set(String(r.title_key), r.verdict as KeepVerdict);
  }
  return hit;
}

/** 제목 배열을 KEEP/DROP 으로 분류. 입력 순서와 1:1 대응되는 배열 반환. */
export async function classifyTitlesKeep(
  titles: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<KeepVerdict[]> {
  const keys = titles.map(titleKey);

  // 1) 캐시 조회 — 중복 제목은 한 번만 본다
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  const verdictByKey = await loadCached(uniqueKeys);

  // 2) 미판정 제목만 Gemini 로. 같은 키가 여러 번 들어와도 1회만 분류한다.
  const pending: { key: string; title: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < titles.length; i++) {
    const k = keys[i];
    if (!k || verdictByKey.has(k) || seen.has(k)) continue;
    seen.add(k);
    pending.push({ key: k, title: titles[i] });
  }

  const fresh: {
    title_key: string;
    verdict: KeepVerdict;
    sample_title: string;
  }[] = [];
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    let verdicts: KeepVerdict[];
    try {
      const raw = await geminiText(buildPrompt(chunk.map((c) => c.title)));
      verdicts = parseVerdicts(raw, chunk.length);
    } catch {
      // 호출 실패 → unknown. 캐시에 쓰지 않는다(실패를 판정으로 굳히면 영구 오분류).
      // 호출부가 "보류 후 재판정"으로 처리한다.
      chunk.forEach((c) => verdictByKey.set(c.key, "unknown"));
      onProgress?.(Math.min(i + BATCH, pending.length), pending.length);
      continue;
    }
    chunk.forEach((c, j) => {
      verdictByKey.set(c.key, verdicts[j]);
      fresh.push({
        title_key: c.key,
        verdict: verdicts[j],
        sample_title: c.title.slice(0, 300),
      });
    });
    onProgress?.(Math.min(i + BATCH, pending.length), pending.length);
  }

  // 3) 새 판정 영속화 (실패해도 분류 결과는 그대로 반환)
  if (fresh.length) {
    const db = createServiceRoleClient();
    for (let i = 0; i < fresh.length; i += LOOKUP_CHUNK)
      await db
        .from("title_keep_verdicts")
        .upsert(fresh.slice(i, i + LOOKUP_CHUNK), { onConflict: "title_key" });
  }

  return keys.map((k) => (k ? (verdictByKey.get(k) ?? "keep") : "keep"));
}
