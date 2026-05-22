import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";

interface BulkBody {
  ids: string[];
  action: "delete";
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as BulkBody;
  const { ids, action } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (action !== "delete") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("artists").delete().in("id", ids);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, count: ids.length });
}
