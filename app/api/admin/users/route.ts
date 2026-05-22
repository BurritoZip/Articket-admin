import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import type { AdminUserRow } from "@/types/admin-user";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";
import { mergeAuthUsersToAdminRows } from "@/lib/admin-users-merge";

type AuthUser = {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
};

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!looksLikeServiceRoleKey(serviceRoleKey)) {
    const fallbackRows = [buildSelfFallbackRow(guard.user.id, guard.user.email)];
    return NextResponse.json({
      rows: fallbackRows,
      ...buildPaginationMeta(1, pageSize, 1),
      warning:
        "SUPABASE_SERVICE_ROLE_KEY가 서비스 롤 키가 아니어서 전체 사용자 조회를 생략했습니다.",
    });
  }

  const admin = createServiceRoleClient();

  try {
    if (q) {
      // user_profiles.display_name 기반 서버 검색
      const { data: profiles, count, error: profileErr } = await admin
        .from("user_profiles")
        .select("id, display_name, role, last_visit_date", { count: "exact" })
        .ilike("display_name", `%${q}%`)
        .range(from, to);

      if (profileErr) throw profileErr;

      const authResults = await Promise.all(
        (profiles ?? []).map((p) => admin.auth.admin.getUserById(p.id)),
      );

      const users: AuthUser[] = authResults
        .filter((r) => !r.error && r.data.user)
        .map((r) => ({
          id: r.data.user!.id,
          email: r.data.user!.email,
          created_at: r.data.user!.created_at,
          last_sign_in_at: r.data.user!.last_sign_in_at ?? null,
        }));

      const rows = await mergeAuthUsersToAdminRows(admin, users);
      return NextResponse.json({
        rows,
        ...buildPaginationMeta(page, pageSize, count ?? 0),
      });
    }

    // 검색 없을 때: listUsers
    const { data: usersData, error: userListError } =
      await admin.auth.admin.listUsers({ page, perPage: pageSize });

    if (userListError) {
      const fallbackRows = [buildSelfFallbackRow(guard.user.id, guard.user.email)];
      return NextResponse.json({
        rows: fallbackRows,
        ...buildPaginationMeta(1, pageSize, 1),
        warning:
          "관리자 사용자 목록 조회에 실패하여 현재 계정만 표시합니다. SUPABASE_SERVICE_ROLE_KEY를 확인하세요.",
      });
    }

    const listPayload = usersData as { users?: AuthUser[]; total?: number };
    const users = (listPayload.users ?? []) as AuthUser[];

    let total =
      typeof listPayload.total === "number" && listPayload.total > 0
        ? listPayload.total
        : 0;
    if (total <= 0 && users.length > 0) {
      total =
        users.length < pageSize
          ? (page - 1) * pageSize + users.length
          : page * pageSize + 1;
    }

    const rows: AdminUserRow[] = await mergeAuthUsersToAdminRows(admin, users);
    return NextResponse.json({ rows, ...buildPaginationMeta(page, pageSize, total) });
  } catch (error) {
    const fallbackRows = [buildSelfFallbackRow(guard.user.id, guard.user.email)];
    return NextResponse.json({
      rows: fallbackRows,
      ...buildPaginationMeta(1, pageSize, 1),
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
