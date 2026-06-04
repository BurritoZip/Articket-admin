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

KEEP = 가수·밴드·아이돌·래퍼·싱어송라이터의 콘서트, 내한공연, 단독/합동 라이브, 음악 페스티벌·페스타·락페.
DROP = 음악 라이브가 아닌 모든 것:
  - 전시·미술·회화·드로잉·조각·아트展·화가 이름 전시(예: 르누아르, 모네, 피카소, 모더니즘, 인상주의 등 미술 사조/화가)·갤러리·박물관·뮤지엄·비엔날레
  - 뮤지컬·연극·오페라·발레·무용·합창·국악·클래식/오케스트라 연주회·리사이틀
  - 강연·토크쇼·북콘서트·인문학·키즈/어린이·행사·박람회·축제(비음악)

판단 규칙:
  - 제목에 가수/밴드 이름이 없고 미술·전시·사조·화가·작품 느낌이면 DROP.
  - "OOO 콘서트"라도 내용이 클래식·국악·뮤지컬 갈라면 DROP.
  - 확실한 대중음악 라이브만 KEEP. 음악인지 아닌지 모호하고 미술/전시 냄새가 나면 DROP.
각 번호에 대해 KEEP 또는 DROP 만 판정해라.
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
