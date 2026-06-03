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
  return `너는 공연 분류기다. 각 항목이 "가수/밴드의 콘서트" 또는 "음악 페스티벌"인지 판별하라.

KEEP = 가수·밴드·아이돌의 콘서트, 내한공연, 단독/합동 라이브, 음악 페스티벌·페스타·락페.
DROP = 그 외 전부 — 뮤지컬, 연극, 클래식/오케스트라 연주회, 오페라, 합창, 발레, 무용, 국악, 전시, 미술, 갤러리, 박물관, 강연·토크, 키즈/어린이, 행사, 박람회.

애매하면 KEEP.
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
