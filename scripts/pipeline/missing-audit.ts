import { createServiceRoleClient } from "../../lib/supabase/service-role";

async function main() {
  const db = createServiceRoleClient();
  const head = (t: string) =>
    db.from(t).select("id", { count: "exact", head: true });
  const active = ["on_sale", "upcoming", "ongoing"];

  const [
    { count: evTotal },
    { count: evNoArtist },
    { count: evNoVenue },
    { count: evNoDate },
    { count: evNoGenre },
    { count: evNoPoster },
    // 진짜 빈칸 = 활성 이벤트 中 단일 아티스트 없음(no_artist 또는 미시도). multi_artist는 정상.
    { count: evTrueNoArtist },
    { count: evMultiArtist },
    { count: evPendingEnrich },
    { count: artTotal },
    { count: artNoAvatar },
    { count: artNoOccupation },
    { count: artNoEnriched },
    { count: venTotal },
    { count: venNoAddr },
  ] = await Promise.all([
    head("events"),
    head("events").is("artist_id", null),
    head("events").is("venue_id", null),
    head("events").is("start_date", null),
    head("events").is("genre", null),
    head("events").is("poster_url", null),
    head("events")
      .is("artist_id", null)
      .in("status", active)
      .eq("artist_link_status", "no_artist"),
    head("events").eq("artist_link_status", "multi_artist"),
    head("events")
      .is("artist_id", null)
      .in("status", active)
      .is("enrich_attempted_at", null),
    head("artists"),
    head("artists").is("avatar_url", null),
    head("artists").is("occupation", null),
    head("artists").or(
      "enrichment_status.is.null,enrichment_status.eq.pending",
    ),
    head("venues"),
    head("venues").or("address.is.null,address.eq."),
  ]);

  const pct = (n: number | null, t: number | null) =>
    `${n ?? 0} (${Math.round(((n ?? 0) / (t ?? 1)) * 100)}%)`;

  console.log(`\n[이벤트] 전체 ${evTotal}개`);
  console.log(`  artist_id 없음(전체):     ${pct(evNoArtist, evTotal)}`);
  console.log(`   └ 페스티벌/다중(정상):    ${evMultiArtist}`);
  console.log(
    `   └ ⚠️ 진짜 미흡(no_artist): ${evTrueNoArtist}  ← 후속 보강 대상`,
  );
  console.log(
    `   └ 아직 미시도(활성):       ${evPendingEnrich}  ← cron이 처리 예정`,
  );
  console.log(`  venue_id 없음:   ${pct(evNoVenue, evTotal)}`);
  console.log(`  start_date 없음: ${evNoDate}`);
  console.log(`  genre 없음:      ${pct(evNoGenre, evTotal)}`);
  console.log(`  poster_url 없음: ${evNoPoster}`);
  console.log(`\n[아티스트] 전체 ${artTotal}개`);
  console.log(`  미보강 대상:      ${pct(artNoEnriched, artTotal)}`);
  console.log(`  avatar_url 없음: ${pct(artNoAvatar, artTotal)}`);
  console.log(`  occupation 없음: ${artNoOccupation}`);
  console.log(`\n[공연장] 전체 ${venTotal}개`);
  console.log(`  address 없음:    ${pct(venNoAddr, venTotal)}`);
}
main().catch(console.error);
