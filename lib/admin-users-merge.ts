import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminUserRow } from "@/types/admin-user";

type AuthUser = {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
};

/** Auth 사용자 목록에 프로필·집계를 붙여 AdminUserRow로 만듭니다. */
export async function mergeAuthUsersToAdminRows(
  admin: SupabaseClient,
  users: AuthUser[],
): Promise<AdminUserRow[]> {
  const ids = users.map((u) => u.id);

  const profilesRes = ids.length
    ? await admin
        .from("user_profiles")
        .select("id, display_name, role, last_visit_date")
        .in("id", ids)
    : { data: [], error: null };

  const profileMap = new Map<
    string,
    {
      display_name: string | null;
      role: string | null;
      last_visit_date: string | null;
    }
  >();
  for (const p of (profilesRes.data ?? []) as Array<{
    id: string;
    display_name: string | null;
    role: string | null;
    last_visit_date: string | null;
  }>) {
    profileMap.set(p.id, p);
  }

  const bookingCountMap = new Map<string, number>();
  const followCountMap = new Map<string, number>();

  if (ids.length > 0) {
    const bookings = await admin
      .from("user_bookings")
      .select("user_id")
      .in("user_id", ids);
    if (!bookings.error) {
      for (const b of (bookings.data ?? []) as Array<{ user_id: string }>) {
        bookingCountMap.set(
          b.user_id,
          (bookingCountMap.get(b.user_id) ?? 0) + 1,
        );
      }
    }

    const followings = await admin
      .from("user_artist_followings")
      .select("user_id")
      .in("user_id", ids);
    if (!followings.error) {
      for (const f of (followings.data ?? []) as Array<{ user_id: string }>) {
        followCountMap.set(f.user_id, (followCountMap.get(f.user_id) ?? 0) + 1);
      }
    }
  }

  return users.map((u) => {
    const profile = profileMap.get(u.id);
    const role = profile?.role === "admin" ? "admin" : "user";
    const lastVisitDate = profile?.last_visit_date ?? u.last_sign_in_at ?? null;

    return {
      id: u.id,
      displayName:
        profile?.display_name || u.email?.split("@")[0] || "이름 없음",
      email: u.email ?? "-",
      role,
      lastVisitDate,
      bookingCount: bookingCountMap.get(u.id) ?? 0,
      followingCount: followCountMap.get(u.id) ?? 0,
      createdAt: u.created_at ?? new Date().toISOString(),
      accountStatus: lastVisitDate ? "active" : "pending",
    };
  });
}
