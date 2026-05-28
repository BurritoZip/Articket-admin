import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface VenueMergeResult {
  ok: boolean;
  reassignments: Record<string, number>;
  errors: string[];
}

export async function mergeVenues(keepId: string, mergeId: string): Promise<VenueMergeResult> {
  const db = createServiceRoleClient();
  const errors: string[] = [];
  const reassignments: Record<string, number> = {};

  const { data: snapshot } = await db.from("venues").select("*").eq("id", mergeId).single();

  // events.venue_id 재지정
  {
    const { data, error } = await db
      .from("events")
      .update({ venue_id: keepId })
      .eq("venue_id", mergeId)
      .select("id");
    if (error) errors.push(`events 재지정 실패: ${error.message}`);
    else reassignments.events = data?.length ?? 0;
  }

  // event_venues 재지정 (unique 충돌 방지)
  {
    const { data: existingKeep } = await db
      .from("event_venues")
      .select("event_id")
      .eq("venue_id", keepId);
    const keepEventIds = new Set(
      (existingKeep as unknown as { event_id: string }[] ?? []).map((r) => r.event_id),
    );
    const { data: mergeRows } = await db
      .from("event_venues")
      .select("id,event_id")
      .eq("venue_id", mergeId);
    const conflictIds: string[] = [];
    const updateIds: string[] = [];
    for (const row of (mergeRows as unknown as { id: string; event_id: string }[] ?? [])) {
      if (keepEventIds.has(row.event_id)) conflictIds.push(row.id);
      else updateIds.push(row.id);
    }
    if (conflictIds.length > 0) await db.from("event_venues").delete().in("id", conflictIds);
    if (updateIds.length > 0) {
      const { error } = await db
        .from("event_venues")
        .update({ venue_id: keepId })
        .in("id", updateIds);
      if (error) errors.push(`event_venues 재지정 실패: ${error.message}`);
    }
    reassignments.event_venues = updateIds.length;
  }

  // keep 공연장 필드 보완
  if (snapshot) {
    const { data: keepVenue } = await db
      .from("venues")
      .select("address,phone_number")
      .eq("id", keepId)
      .single();
    if (keepVenue) {
      const patch: Record<string, string> = {};
      if (!keepVenue.address && snapshot.address) patch.address = snapshot.address;
      if (!keepVenue.phone_number && snapshot.phone_number)
        patch.phone_number = snapshot.phone_number;
      if (Object.keys(patch).length > 0) {
        await db.from("venues").update(patch).eq("id", keepId);
      }
    }
  }

  // merge 행 삭제
  const { error: deleteError } = await db.from("venues").delete().eq("id", mergeId);
  if (deleteError) errors.push(`공연장 삭제 실패: ${deleteError.message}`);

  return { ok: errors.length === 0, reassignments, errors };
}
