import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withErrorHandler } from "@/lib/api-handler";

export const GET = withErrorHandler(async () => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("crawler_sources")
    .select("*")
    .order("name");

  if (error) return NextResponse.json({ error: error.message, rows: [] }, { status: 400 });
  return NextResponse.json({ rows: data ?? [] });
});
