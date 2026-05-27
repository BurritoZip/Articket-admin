import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/require-admin";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createClient();

  const [
    avatar,
    occupation,
    label,
    country,
    birthDate,
    birthPlace,
    related,
    allNames,
  ] = await Promise.all([
    supabase
      .from("artists")
      .select("id", { count: "exact", head: true })
      .or("avatar_url.is.null,avatar_url.eq."),
    supabase
      .from("artists")
      .select("id", { count: "exact", head: true })
      .or("occupation.is.null,occupation.eq."),
    supabase
      .from("artists")
      .select("id", { count: "exact", head: true })
      .or("label.is.null,label.eq."),
    supabase
      .from("artists")
      .select("id", { count: "exact", head: true })
      .or("country.is.null,country.eq."),
    supabase
      .from("artists")
      .select("id", { count: "exact", head: true })
      .is("birth_date", null),
    supabase
      .from("artists")
      .select("id", { count: "exact", head: true })
      .or("birth_place.is.null,birth_place.eq."),
    supabase
      .from("artists")
      .select("id", { count: "exact", head: true })
      .or("related.is.null,related.eq."),
    supabase.from("artists").select("name"),
  ]);

  const nameCounts: Record<string, number> = {};
  for (const row of allNames.data ?? []) {
    nameCounts[row.name] = (nameCounts[row.name] ?? 0) + 1;
  }
  const duplicateCount = Object.values(nameCounts)
    .filter((c) => c > 1)
    .reduce((sum, c) => sum + c, 0);

  // 보강 대기 중인 아티스트 수 (미처리=NULL + pending + failed 모두 포함)
  const enrichmentPending = await supabase
    .from("artists")
    .select("id", { count: "exact", head: true })
    .or(
      "enrichment_status.is.null,enrichment_status.eq.pending,enrichment_status.eq.failed",
    );

  // name_en 누락 수
  const nameEnMissing = await supabase
    .from("artists")
    .select("id", { count: "exact", head: true })
    .or("name_en.is.null,name_en.eq.");

  return NextResponse.json({
    missingCounts: {
      avatar_url: avatar.count ?? 0,
      occupation: occupation.count ?? 0,
      label: label.count ?? 0,
      country: country.count ?? 0,
      birth_date: birthDate.count ?? 0,
      birth_place: birthPlace.count ?? 0,
      related: related.count ?? 0,
      name_en: nameEnMissing.count ?? 0,
    },
    duplicateCount,
    enrichmentPending: enrichmentPending.count ?? 0,
  });
}
