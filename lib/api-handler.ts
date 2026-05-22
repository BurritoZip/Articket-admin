import { NextResponse } from "next/server";

type Handler = (request: Request, context?: unknown) => Promise<NextResponse | Response>;

/** API 라우트를 try/catch로 감싸 항상 JSON 응답을 보장 */
export function withErrorHandler(handler: Handler): Handler {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[API Error]", request.url, message);
      return NextResponse.json(
        { error: "internal_server_error", detail: message },
        { status: 500 },
      );
    }
  };
}

/** 클라이언트에서 fetch 응답을 안전하게 JSON 파싱 */
export async function safeJson<T>(res: Response, fallback: T): Promise<T> {
  try {
    const text = await res.text();
    if (!text) return fallback;
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
