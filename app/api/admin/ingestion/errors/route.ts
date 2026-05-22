import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withErrorHandler } from "@/lib/api-handler";

export const GET = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const jobId = url.searchParams.get("job_id");
  const source = url.searchParams.get("source");
  const step = url.searchParams.get("step");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const db = createServiceRoleClient();
  let q = db
    .from("ingestion_errors")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (jobId) q = q.eq("job_id", jobId);
  if (source) q = q.eq("source_name", source);
  if (step) q = q.eq("step", step);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message, rows: [], total: 0 }, { status: 400 });

  return NextResponse.json({ rows: data ?? [], total: count ?? 0, page, limit });
});
