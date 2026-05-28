import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const db = createServiceRoleClient();
  const { data } = await db
    .from("pipeline_step_status")
    .select("step_name,status,started_at,finished_at,result,error")
    .order("step_name");

  return NextResponse.json({ steps: data ?? [] });
}
