import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import type { AdminUserRow } from "@/types/admin-user";

type AuthUser = {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
};

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!looksLikeServiceRoleKey(serviceRoleKey)) {
    const fallbackRows = [
      buildSelfFallbackRow(guard.user.id, guard.user.email),
    ];
    return NextResponse.json({
      rows: fallbackRows,
      warning:
        "SUPABASE_SERVICE_ROLE_KEY가 서비스 롤 키가 아니어서 전체 사용자 조회를 생략했습니다.",
    });
  }

  try {
    const admin = createServiceRoleClient();

    const { data: usersData, error: userListError } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

    if (userListError) {
      const fallbackRows = [
        buildSelfFallbackRow(guard.user.id, guard.user.email),
      ];
      return NextResponse.json({
        rows: fallbackRows,
        warning:
          "관리자 사용자 목록 조회에 실패하여 현재 계정만 표시합니다. SUPABASE_SERVICE_ROLE_KEY를 확인하세요.",
      });
    }

    const users = (usersData?.users ?? []) as AuthUser[];
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

    // 테이블이 아직 없거나 비어 있어도 API가 죽지 않도록 방어
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
          followCountMap.set(
            f.user_id,
            (followCountMap.get(f.user_id) ?? 0) + 1,
          );
        }
      }
    }

    const rows: AdminUserRow[] = users.map((u) => {
      const profile = profileMap.get(u.id);
      const role = profile?.role === "admin" ? "admin" : "user";
      const lastVisitDate =
        profile?.last_visit_date ?? u.last_sign_in_at ?? null;

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

    return NextResponse.json({ rows });
  } catch (error) {
    const fallbackRows = [
      buildSelfFallbackRow(guard.user.id, guard.user.email),
    ];
    return NextResponse.json({
      rows: fallbackRows,
      warning:
        error instanceof Error
          ? `서비스 롤 키 확인 필요: ${error.message}`
          : "서비스 롤 키 확인 필요",
    });
  }
}

function looksLikeServiceRoleKey(key: string): boolean {
  const parts = key.split(".");
  if (parts.length < 2) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64").toString("utf8"),
    ) as { role?: string };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

function buildSelfFallbackRow(
  id: string,
  email: string | undefined,
): AdminUserRow {
  return {
    id,
    displayName: "관리자",
    email: email ?? "-",
    role: "admin",
    lastVisitDate: new Date().toISOString(),
    bookingCount: 0,
    followingCount: 0,
    createdAt: new Date().toISOString(),
    accountStatus: "active",
  };
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    email?: string;
    displayName?: string;
    role?: "user" | "admin";
  };

  if (!body.email) {
    return NextResponse.json({ error: "email_required" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(body.email, {
    data: { display_name: body.displayName ?? "" },
  });

  if (error) {
    return NextResponse.json(
      { error: "invite_failed", detail: error.message },
      { status: 400 },
    );
  }

  if (data.user?.id) {
    await admin.from("user_profiles").upsert({
      id: data.user.id,
      display_name: body.displayName ?? "",
      role: body.role ?? "user",
    });
  }

  return NextResponse.json({ ok: true });
}
