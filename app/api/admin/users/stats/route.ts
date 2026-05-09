import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { mergeAuthUsersToAdminRows } from "@/lib/admin-users-merge";

type AuthUser = {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
};

/** 대시보드 카드용 집계. Auth API 샘플(최대 1000명) 기준 — 전체 유저가 더 많으면 비율은 참고용입니다. */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!looksLikeServiceRoleKey(serviceRoleKey)) {
    return NextResponse.json({
      totalUsers: 1,
      pending: 0,
      suspended: 0,
      recent: 0,
      sampleLimited: true,
    });
  }

  try {
    const admin = createServiceRoleClient();
    const { data: usersData, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (error) {
      return NextResponse.json(
        { error: "stats_failed", detail: error.message },
        { status: 400 },
      );
    }

    const payload = usersData as {
      users?: AuthUser[];
      total?: number;
    };
    const users = (payload.users ?? []) as AuthUser[];
    const totalUsers =
      typeof payload.total === "number" && payload.total > 0
        ? payload.total
        : users.length;

    const rows = await mergeAuthUsersToAdminRows(admin, users);
    const pending = rows.filter((u) => u.accountStatus === "pending").length;
    const suspended = rows.filter(
      (u) => u.accountStatus === "suspended",
    ).length;
    const recent = rows.filter((u) => {
      if (!u.lastVisitDate) return false;
      const d = new Date(u.lastVisitDate);
      return Date.now() - d.getTime() < 7 * 86400000;
    }).length;

    return NextResponse.json({
      totalUsers,
      pending,
      suspended,
      recent,
      sampleLimited: totalUsers > users.length,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "stats_failed",
        detail: e instanceof Error ? e.message : "unknown",
      },
      { status: 400 },
    );
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
