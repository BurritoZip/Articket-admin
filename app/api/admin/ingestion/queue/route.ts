import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withErrorHandler } from "@/lib/api-handler";
import type { AITaskType } from "@/types/crawler";

export const GET = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const taskType = url.searchParams.get("task_type");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

  const db = createServiceRoleClient();
  let q = db
    .from("ai_processing_queue")
    .select(
      "id,task_type,status,priority,entity_type,entity_id,payload,error,attempts,max_attempts,created_at,processed_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) q = q.eq("status", status);
  if (taskType) q = q.eq("task_type", taskType);

  const { data, error, count } = await q;
  if (error)
    return NextResponse.json(
      { error: error.message, rows: [], total: 0 },
      { status: 400 },
    );

  // 상태별 카운트
  const { data: statusCounts } = await db
    .from("ai_processing_queue")
    .select("status");
  const byStatus: Record<string, number> = {};
  for (const row of statusCounts ?? []) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }

  return NextResponse.json({ rows: data ?? [], total: count ?? 0, byStatus });
});

/** 큐 항목 삭제 — ?ids=a,b,c 또는 ?status=done&confirm=true */
export const DELETE = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const ids = url.searchParams.get("ids");
  const statusFilter = url.searchParams.get("status");
  const confirm = url.searchParams.get("confirm") === "true";

  const db = createServiceRoleClient();

  if (ids) {
    const idList = ids.split(",").filter(Boolean);
    const { error } = await db
      .from("ai_processing_queue")
      .delete()
      .in("id", idList);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, deleted: idList.length });
  }

  if (statusFilter && confirm) {
    const { error, count } = await db
      .from("ai_processing_queue")
      .delete({ count: "exact" })
      .eq("status", statusFilter);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, deleted: count ?? 0 });
  }

  return NextResponse.json(
    { error: "ids 또는 status+confirm=true 필요" },
    { status: 400 },
  );
});

export const POST = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    task_type: AITaskType;
    payload: Record<string, unknown>;
    entity_type?: string;
    entity_id?: string;
    priority?: number;
  };

  if (!body.task_type || !body.payload) {
    return NextResponse.json(
      { error: "task_type and payload required" },
      { status: 400 },
    );
  }

  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("ai_processing_queue")
    .insert({
      task_type: body.task_type,
      payload: body.payload,
      entity_type: body.entity_type ?? null,
      entity_id: body.entity_id ?? null,
      priority: body.priority ?? 5,
    })
    .select("id")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
});
