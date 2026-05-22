import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { AITaskType } from "@/types/crawler";

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const taskType = url.searchParams.get("task_type");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

  const db = createServiceRoleClient();
  let q = db
    .from("ai_processing_queue")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) q = q.eq("status", status);
  if (taskType) q = q.eq("task_type", taskType);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ rows: data ?? [], total: count ?? 0 });
}

export async function POST(request: Request) {
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
    return NextResponse.json({ error: "task_type and payload required" }, { status: 400 });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}
