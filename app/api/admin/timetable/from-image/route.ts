import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ParsedPerformance {
  artist_name: string;
  stage_name: string;
  start_time: string;
  end_time: string;
  day_number: number;
  date_string: string;
}

const PROMPT = (startDate: string | null, endDate: string | null) => {
  const dateContext = [
    startDate ? `공연 시작일(DAY 1): ${startDate}` : "",
    endDate && endDate !== startDate
      ? `공연 둘째 날(DAY 2): ${endDate}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `이 이미지는 음악 페스티벌 타임테이블입니다.
이미지에서 모든 아티스트 공연 정보를 JSON 배열로 추출하세요.

각 항목 형식:
{
  "artist_name": "아티스트명 (필수)",
  "stage_name": "스테이지/무대명 (없으면 빈 문자열)",
  "start_time": "HH:MM 24시간제 (없으면 빈 문자열)",
  "end_time": "HH:MM 24시간제 (없으면 빈 문자열)",
  "day_number": 1,
  "date_string": "YYYY-MM-DD (없으면 빈 문자열)"
}

규칙:
- day_number: DAY 1 = 1, DAY 2 = 2 (구분 없으면 1)
- 시간은 반드시 24시간제 HH:MM 형식
- 스테이지명은 이미지에서 보이는 그대로 추출
- 아티스트 이름은 원문 그대로 (한국어/영어 혼용 포함)
${dateContext ? `\n참고:\n${dateContext}` : ""}

JSON 배열만 반환하세요 (코드블록 사용 가능).`;
};

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "gemini_api_key_missing", detail: "GEMINI_API_KEY 환경 변수가 없습니다." },
      { status: 500 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const imageFile = formData.get("image") as File | null;
  const startDate = (formData.get("start_date") as string | null)?.trim() || null;
  const endDate = (formData.get("end_date") as string | null)?.trim() || null;

  if (!imageFile) {
    return NextResponse.json({ error: "image_required" }, { status: 400 });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];
  const mimeType = imageFile.type || "image/jpeg";
  if (!allowedTypes.includes(mimeType)) {
    return NextResponse.json(
      { error: "unsupported_image_type", detail: `${mimeType} 형식은 지원하지 않습니다.` },
      { status: 400 },
    );
  }

  const arrayBuffer = await imageFile.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({ model: "gemini-2.0-flash" });

  try {
    const result = await model.generateContent([
      PROMPT(startDate, endDate),
      { inlineData: { data: base64, mimeType } },
    ]);

    const text = result.response.text();

    // Extract JSON array from response
    const jsonMatch =
      text.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ??
      text.match(/(\[[\s\S]+\])/);
    const jsonStr = jsonMatch?.[1] ?? text.trim();

    let performances: unknown;
    try {
      performances = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: "parse_failed", detail: "Gemini 응답에서 JSON을 파싱하지 못했습니다.", raw: text },
        { status: 500 },
      );
    }

    if (!Array.isArray(performances)) {
      return NextResponse.json(
        { error: "parse_failed", detail: "응답이 배열 형식이 아닙니다.", raw: text },
        { status: 500 },
      );
    }

    const cleaned = (performances as Record<string, unknown>[])
      .filter((p) => typeof p.artist_name === "string" && p.artist_name.trim())
      .map((p) => ({
        artist_name: String(p.artist_name ?? "").trim(),
        stage_name: String(p.stage_name ?? "").trim(),
        start_time: String(p.start_time ?? "").trim(),
        end_time: String(p.end_time ?? "").trim(),
        day_number: Number(p.day_number ?? 1) || 1,
        date_string: String(p.date_string ?? "").trim(),
      })) as ParsedPerformance[];

    return NextResponse.json({ ok: true, performances: cleaned });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "gemini_error", detail: msg },
      { status: 500 },
    );
  }
}
