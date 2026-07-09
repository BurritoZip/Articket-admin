/**
 * Gemini 공용 클라이언트 유틸 + 지출상한/쿼터 서킷브레이커
 *
 * 배경: 월 지출 상한(spending cap)이나 쿼터에 걸리면 모든 Gemini 호출이 429 로 실패한다.
 * 그런데도 파이프라인은 후보마다 계속 호출해 낭비·소음·지연이 생긴다.
 * 한 번 쿼터 에러를 만나면 이 프로세스 동안 이후 호출을 즉시 fast-fail 시켜(HTTP 안 침)
 * 폭주를 막고, 명확한 에러(GeminiQuotaError)로 통일한다. 최초 감지 시 Slack 1회 알림.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { postSlack } from "@/lib/slack";

let _client: GoogleGenerativeAI | null = null;

// 이 프로세스에서 쿼터/상한에 걸렸는지 (걸리면 이후 호출 즉시 실패)
let quotaTrip: string | null = null;

export class GeminiQuotaError extends Error {
  constructor(reason: string) {
    super(`Gemini 사용 한도 초과(지출 상한/쿼터): ${reason}`);
    this.name = "GeminiQuotaError";
  }
}

/** 현재 쿼터 서킷이 열렸는지(호출 스킵 판단용) */
export function isGeminiQuotaExhausted(): boolean {
  return quotaTrip !== null;
}

function looksLikeQuota(msg: string): boolean {
  return /429|too many requests|spending cap|quota|resource[_ ]?exhausted|exceeded its (monthly )?spend/i.test(
    msg,
  );
}

export function getGeminiClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 환경 변수가 없습니다.");
  if (!_client) _client = new GoogleGenerativeAI(key);
  return _client;
}

async function runModel(prompt: string, grounded: boolean, model: string) {
  // 이미 상한에 걸렸으면 더 호출하지 않고 즉시 실패(폭주 방지).
  if (quotaTrip) throw new GeminiQuotaError(quotaTrip);

  const genai = getGeminiClient();
  const m = genai.getGenerativeModel(
    grounded
      ? // @google/generative-ai 타입에 googleSearch 툴이 아직 없어 캐스팅.
        { model, tools: [{ googleSearch: {} }] as unknown as never }
      : { model },
  );
  try {
    const result = await m.generateContent(prompt);
    return result.response.text().trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (looksLikeQuota(msg)) {
      if (!quotaTrip) {
        quotaTrip = msg.slice(0, 300);
        // 최초 감지 1회만 Slack 알림(이후 호출은 조용히 fast-fail).
        void postSlack(
          `:warning: *Gemini 사용 한도 초과* — 이후 보강/분류/삭제 판단이 이번 실행 동안 스킵됩니다.\nai.studio/spend 에서 상한 확인 필요.\n\`${quotaTrip}\``,
        );
      }
      throw new GeminiQuotaError(quotaTrip);
    }
    throw e;
  }
}

export async function geminiText(
  prompt: string,
  model = "gemini-2.5-flash",
): Promise<string> {
  return runModel(prompt, false, model);
}

/**
 * 구글검색 그라운딩 붙은 Gemini 호출 — 실제 웹에서 사실 확인이 필요한 경우(예: 예매일자).
 * 그라운딩 없는 geminiText 는 환각 위험이 커 날짜 추출에 쓰면 안 된다.
 */
export async function geminiTextGrounded(
  prompt: string,
  model = "gemini-2.5-flash",
): Promise<string> {
  return runModel(prompt, true, model);
}
