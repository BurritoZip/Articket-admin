import { createServiceRoleClient } from "../../lib/supabase/service-role";

async function main() {
  const db = createServiceRoleClient();
  const [
    { count: evTotal }, { count: evNoArtist }, { count: evNoVenue },
    { count: evNoDate }, { count: evNoGenre }, { count: evNoPoster },
    { count: artTotal }, { count: artNoAvatar }, { count: artNoOccupation },
    { count: artNoEnriched },
    { count: venTotal }, { count: venNoAddr },
  ] = await Promise.all([
    db.from("events").select("id", { count: "exact", head: true }),
    db.from("events").select("id", { count: "exact", head: true }).is("artist_id", null),
    db.from("events").select("id", { count: "exact", head: true }).is("venue_id", null),
    db.from("events").select("id", { count: "exact", head: true }).is("start_date", null),
    db.from("events").select("id", { count: "exact", head: true }).is("genre", null),
    db.from("events").select("id", { count: "exact", head: true }).is("poster_url", null),
    db.from("artists").select("id", { count: "exact", head: true }),
    db.from("artists").select("id", { count: "exact", head: true }).is("avatar_url", null),
    db.from("artists").select("id", { count: "exact", head: true }).is("occupation", null),
    db.from("artists").select("id", { count: "exact", head: true })
      .or("enrichment_status.is.null,enrichment_status.eq.pending"),
    db.from("venues").select("id", { count: "exact", head: true }),
    db.from("venues").select("id", { count: "exact", head: true })
      .or("address.is.null,address.eq."),
  ]);

  const pct = (n: number | null, t: number | null) =>
    `${n ?? 0} (${Math.round(((n ?? 0) / (t ?? 1)) * 100)}%)`;

  console.log(`\n[이벤트] 전체 ${evTotal}개`);
  console.log(`  artist_id 없음:  ${pct(evNoArtist, evTotal)}`);
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
