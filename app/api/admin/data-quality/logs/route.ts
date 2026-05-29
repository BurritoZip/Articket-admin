import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 200);
  const entityType = url.searchParams.get("entity_type");
  const method = url.searchParams.get("method");

  const db = createServiceRoleClient();
  let query = db
    .from("data_quality_fix_logs")
    .select(
      "id,entity_type,entity_id,field_name,issue_type,old_value,fix_method,fixed_at,gemini_reasoning,gemini_prompt,error_msg",
    )
    .order("fixed_at", { ascending: false })
    .limit(limit);

  if (entityType) query = query.eq("entity_type", entityType);
  if (method) query = query.eq("fix_method", method);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ logs: data ?? [], total: data?.length ?? 0 });
}
