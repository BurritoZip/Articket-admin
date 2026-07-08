/**
 * 공연 분류 — "남길 것 vs 지울 것"
 *
 * 정책(운영자 결정): **오로지 가수/밴드의 콘서트 + 음악 페스티벌만 남긴다.**
 * 그 외(뮤지컬·연극·클래식/오케스트라·오페라·발레·무용·전시·미술·강연·키즈 등)는 전부 제거 대상.
 *
 * Gemini 배치 분류 — 제목 여러 개를 한 번에 판별해 호출 수를 줄인다.
 * 불확실/파싱실패는 KEEP 으로 처리(삭제는 되돌릴 수 없으므로 보수적으로).
 */
import { geminiText } from "@/lib/gemini";

export type KeepVerdict = "keep" | "drop";

const BATCH = 25;

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

/** 제목 배열을 KEEP/DROP 으로 분류. 입력 순서와 1:1 대응되는 배열 반환. */
export async function classifyTitlesKeep(
  titles: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<KeepVerdict[]> {
  const result: KeepVerdict[] = [];
  for (let i = 0; i < titles.length; i += BATCH) {
    const chunk = titles.slice(i, i + BATCH);
    let verdicts: KeepVerdict[];
    try {
      const raw = await geminiText(buildPrompt(chunk));
      verdicts = parseVerdicts(raw, chunk.length);
    } catch {
      verdicts = Array(chunk.length).fill("keep"); // 호출 실패 → 보존
    }
    result.push(...verdicts);
    onProgress?.(Math.min(i + BATCH, titles.length), titles.length);
  }
  return result;
}
