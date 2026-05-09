import { createBrowserClient } from "@supabase/ssr";

/** 클라이언트 컴포넌트용 — 쿠키 세션과 미들웨어/서버와 동기화 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
