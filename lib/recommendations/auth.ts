import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export type RequireUserResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/**
 * iOS 앱이 보낸 Supabase user JWT 검증 (admin이 아닌 일반 로그인 유저).
 * `Authorization: Bearer <access_token>` 헤더에서 토큰을 읽어 auth.getUser로 검증.
 * requireAdmin(쿠키세션+role=admin)과 달리 역할 체크 없음.
 */
export async function requireUser(request: Request): Promise<RequireUserResult> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const {
    data: { user },
    error,
  } = await sb.auth.getUser(token);

  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, userId: user.id };
}
