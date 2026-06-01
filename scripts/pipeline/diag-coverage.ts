import { createServiceRoleClient } from "../../lib/supabase/service-role";

// 진단: 단일 컬럼(artist_id/venue_id) null이 진짜 누락인지, 조인테이블로 연결됐는지 구분.
async function main() {
  const db = createServiceRoleClient();

  const head = (q: any) => q.select("id", { count: "exact", head: true });

  // 1) events 전체 + 단일 컬럼 null
  const [{ count: evTotal }, { count: evNoArtistId }, { count: evNoVenueId }] =
    await Promise.all([
      head(db.from("events")),
      head(db.from("events")).is("artist_id", null),
      head(db.from("events")).is("venue_id", null),
    ]);

  // 2) 조인테이블 커버리지 — distinct event_id
  const eaEventIds = new Set<string>();
  const evEventIds = new Set<string>();
  for (const [tbl, set] of [
    ["event_artists", eaEventIds],
    ["event_venues", evEventIds],
  ] as const) {
    let from = 0;
    for (;;) {
      const { data } = await db
        .from(tbl)
        .select("event_id")
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const r of data) set.add(r.event_id as string);
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  // 3) artist_id null 인데 event_artists 있는 events (= 구조적, 진짜 누락 아님)
  //    artist_id null 이고 event_artists 도 없는 events (= 진짜 누락)
  let evArtistIdNullButJoined = 0;
  let evTrulyNoArtist = 0;
  {
    let from = 0;
    for (;;) {
      const { data } = await db
        .from("events")
        .select("id")
        .is("artist_id", null)
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const r of data) {
        if (eaEventIds.has(r.id)) evArtistIdNullButJoined++;
        else evTrulyNoArtist++;
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  // 4) enrich 큐 + 상태 분포
  const queueStatus: Record<string, number> = {};
  {
    let from = 0;
    for (;;) {
      const { data } = await db
        .from("ai_processing_queue")
        .select("status,entity_type")
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const r of data) {
        const k = `${r.entity_type}/${r.status}`;
        queueStatus[k] = (queueStatus[k] ?? 0) + 1;
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  const artStatus: Record<string, number> = {};
  {
    let from = 0;
    for (;;) {
      const { data } = await db
        .from("artists")
        .select("enrichment_status")
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const r of data) {
        const k = r.enrichment_status ?? "(null)";
        artStatus[k] = (artStatus[k] ?? 0) + 1;
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  console.log(`\n=== EVENTS (총 ${evTotal}) ===`);
  console.log(`artist_id 컬럼 null:        ${evNoArtistId}`);
  console.log(`venue_id 컬럼 null:         ${evNoVenueId}`);
  console.log(`event_artists 연결된 event: ${eaEventIds.size}`);
  console.log(`event_venues 연결된 event:  ${evEventIds.size}`);
  console.log(`→ artist_id null 이지만 event_artists 있음 (구조적): ${evArtistIdNullButJoined}`);
  console.log(`→ artist_id null 이고 event_artists 도 없음 (진짜 누락): ${evTrulyNoArtist}`);

  console.log(`\n=== ai_processing_queue ===`);
  console.log(Object.keys(queueStatus).length ? queueStatus : "(비어있음)");

  console.log(`\n=== artists.enrichment_status 분포 ===`);
  console.log(artStatus);
}
main().catch(console.error);
