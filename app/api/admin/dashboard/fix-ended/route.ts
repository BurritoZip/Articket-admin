import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";

export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  // end_date가 지났지만 status가 ended가 아닌 이벤트를 일괄 종료 처리
  const { data, error } = await supabase
    .from("events")
    .update({ status: "ended" })
    .lt("end_date", now)
    .neq("status", "ended")
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: "fix_failed", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, updated: (data ?? []).length });
}
