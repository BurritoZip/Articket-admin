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
