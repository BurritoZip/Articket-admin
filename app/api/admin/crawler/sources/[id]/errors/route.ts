/**
 * GET /api/admin/crawler/sources/[id]/errors
 * 특정 소스의 최근 structure_change 오류 목록 반환
 *
 * [id] = source.name (UUID가 아닌 name 필드 사용)
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id: sourceName } = await params;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "10"), 50);
  const step = searchParams.get("step") ?? "structure_change";

  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("ingestion_errors")
    .select("id, step, error_type, error_message, raw_payload, created_at")
    .eq("source_name", sourceName)
    .eq("step", step)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message, rows: [] }, { status: 400 });
  }

  return NextResponse.json({ rows: data ?? [] });
}
