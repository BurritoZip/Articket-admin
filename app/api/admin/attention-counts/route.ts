import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";

/**
 * 운영자가 "즉시 처리해야 할" 미해결 건수를 href 별로 반환.
 * 네비 뱃지·대시보드 카드가 폴링해 한눈에 보여준다. 경량(head count)만 수행.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const db = createServiceRoleClient();

  const [errorLogs, timetableUnmatched] = await Promise.all([
    db
      .from("app_error_logs")
      .select("id", { count: "exact", head: true })
      .eq("is_resolved", false),
    db
      .from("timetable_unmatched_artists")
      .select("id", { count: "exact", head: true })
      .eq("is_resolved", false),
  ]);

  return NextResponse.json({
    counts: {
      "/admin/error-logs": errorLogs.count ?? 0,
      "/admin/timetable-unmatched": timetableUnmatched.count ?? 0,
    },
  });
}
