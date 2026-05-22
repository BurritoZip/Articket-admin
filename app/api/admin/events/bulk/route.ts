import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";

interface BulkBody {
  ids: string[];
  action: "delete" | "set_status";
  payload?: { status: string };
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as BulkBody;
  const { ids, action, payload } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  if (action === "delete") {
    const { error } = await supabase.from("events").delete().in("id", ids);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (action === "set_status") {
    if (!payload?.status) {
      return NextResponse.json({ error: "payload.status required" }, { status: 400 });
    }
    const { error } = await supabase
      .from("events")
      .update({ status: payload.status })
      .in("id", ids);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, count: ids.length });
}
