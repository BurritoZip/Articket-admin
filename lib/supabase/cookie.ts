/** @supabase/ssr setAll 콜백 인자 타입 */
export type CookieToSet = {
  name: string;
  value: string;
  options?: Partial<{
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax" | "strict" | "none";
    maxAge: number;
    path: string;
    domain: string;
  }>;
};
