import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { withErrorHandler } from "@/lib/api-handler";
import { postSlack } from "@/lib/slack";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";

// 앱 런타임 에러/크래시 로그 조회 (iOS 등 클라이언트가 app_error_logs 에 직접 기록)
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const type = url.searchParams.get("type")?.trim(); // crash|network|decoding|http|runtime
  const platform = url.searchParams.get("platform")?.trim(); // ios|android|web
  // status=unresolved 미해결만 / all 전체
  const status = url.searchParams.get("status")?.trim() ?? "all";
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("app_error_logs")
    .select(
      "id, platform, error_type, message, domain, stack_trace, context, app_version, os_version, device_model, app_user_id, is_resolved, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q) query = query.ilike("message", `%${q}%`);
  if (type) query = query.eq("error_type", type);
  if (platform) query = query.eq("platform", platform);
  if (status === "unresolved") query = query.eq("is_resolved", false);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data: data ?? [],
    meta: buildPaginationMeta(page, pageSize, count ?? 0),
  });
}

// 에러 로그 해결 여부 토글 (운영자가 확인/처리 완료 표시)
export const PATCH = withErrorHandler(async (request: Request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    id?: string;
    is_resolved?: boolean;
  };
  if (!body.id || typeof body.is_resolved !== "boolean") {
    return NextResponse.json(
      { error: "id 와 is_resolved(boolean) 필요" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("app_error_logs")
    .update({ is_resolved: body.is_resolved })
    .eq("id", body.id)
    .select("message, error_type, domain, platform, app_version")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 해결됨으로 표시되면 Slack 알림 (SLACK_WEBHOOK_URL 설정 시). 실패는 흐름 안 막음.
  if (body.is_resolved && data) {
    const r = data as {
      message: string;
      error_type: string;
      domain: string | null;
      platform: string;
      app_version: string | null;
    };
    void postSlack(
      `:white_check_mark: *앱 에러 해결됨*\n` +
        `• 유형: ${r.error_type}\n` +
        `• 메시지: ${r.message}\n` +
        `• 위치: ${r.domain ?? "-"}\n` +
        `• 환경: ${r.platform}${r.app_version ? ` · ${r.app_version}` : ""}`,
    );
  }

  return NextResponse.json({ ok: true });
});
