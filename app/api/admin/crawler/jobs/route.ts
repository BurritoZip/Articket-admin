import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withErrorHandler } from "@/lib/api-handler";

export const GET = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const source = url.searchParams.get("source");
  const status = url.searchParams.get("status");

  const db = createServiceRoleClient();
  let q = db
    .from("crawler_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (source) q = q.eq("source_name", source);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message, rows: [] }, { status: 400 });

  return NextResponse.json({ rows: data ?? [] });
});
