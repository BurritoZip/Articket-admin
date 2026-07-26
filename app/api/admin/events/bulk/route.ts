import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { recomputeUpcomingCount } from "@/lib/db/recompute-upcoming";

interface BulkBody {
  ids: string[];
  action: "delete" | "set_status";
  payload?: { status: string };
}

const VALID_STATUSES = ["upcoming", "on_sale", "ongoing", "ended"];

/** 이벤트 id 들에 연결된 아티스트 id 수집 (event_artists + events.artist_id). */
async function affectedArtistIds(
  supabase: ReturnType<typeof createServiceRoleClient>,
  ids: string[],
): Promise<string[]> {
  const [ea, ev] = await Promise.all([
    supabase.from("event_artists").select("artist_id").in("event_id", ids),
    supabase.from("events").select("artist_id").in("id", ids),
  ]);
  const set = new Set<string>();
  for (const r of (ea.data ?? []) as { artist_id: string | null }[])
    if (r.artist_id) set.add(r.artist_id);
  for (const r of (ev.data ?? []) as { artist_id: string | null }[])
    if (r.artist_id) set.add(r.artist_id);
  return Array.from(set);
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

  // 벌크 뮤테이션 후 아티스트 upcoming_event_count 가 stale 해지지 않게 재계산.
  // (삭제는 행이 사라지기 전에 대상 아티스트를 미리 수집)
  const artistIds = await affectedArtistIds(supabase, ids);

  if (action === "delete") {
    const { error } = await supabase.from("events").delete().in("id", ids);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (action === "set_status") {
    if (!payload?.status || !VALID_STATUSES.includes(payload.status)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }
    // 상태 변경 + status pin(sweeper 되돌림 방지) 을 한 문장으로.
    const { error } = await supabase.rpc("bulk_set_event_status", {
      p_ids: ids,
      p_status: payload.status,
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  await Promise.all(artistIds.map(recomputeUpcomingCount));

  return NextResponse.json({ ok: true, count: ids.length });
}
