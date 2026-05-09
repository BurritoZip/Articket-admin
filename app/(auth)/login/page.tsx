import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const nextPath =
    typeof searchParams.next === "string"
      ? searchParams.next
      : "/admin/dashboard";
  const initialError =
    typeof searchParams.error === "string" ? searchParams.error : undefined;
  const safeNext =
    nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? nextPath
      : "/admin/dashboard";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role === "admin") {
      redirect(safeNext);
    }
  }

  return <LoginForm nextPath={safeNext} initialError={initialError} />;
}
