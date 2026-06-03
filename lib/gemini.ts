/**
 * Gemini 공용 클라이언트 유틸
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

let _client: GoogleGenerativeAI | null = null;

export function getGeminiClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 환경 변수가 없습니다.");
  if (!_client) _client = new GoogleGenerativeAI(key);
  return _client;
}

export async function geminiText(
  prompt: string,
  model = "gemini-2.5-flash",
): Promise<string> {
  const genai = getGeminiClient();
  const m = genai.getGenerativeModel({ model });
  const result = await m.generateContent(prompt);
  return result.response.text().trim();
}

/**
 * 구글검색 그라운딩 붙은 Gemini 호출 — 실제 웹에서 사실 확인이 필요한 경우(예: 예매일자).
 * 그라운딩 없는 geminiText 는 환각 위험이 커 날짜 추출에 쓰면 안 된다.
 */
export async function geminiTextGrounded(
  prompt: string,
  model = "gemini-2.5-flash",
): Promise<string> {
  const genai = getGeminiClient();
  // @google/generative-ai 타입에 googleSearch 툴이 아직 없어 캐스팅.
  const m = genai.getGenerativeModel({
    model,
    tools: [{ googleSearch: {} }] as unknown as never,
  });
  const result = await m.generateContent(prompt);
  return result.response.text().trim();
}
