import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // 인증이 필요한 경로에만 미들웨어 적용 (정적 에셋 404 방지)
  matcher: ["/admin/:path*", "/login"],
};
