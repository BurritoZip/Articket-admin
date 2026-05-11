import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/require-admin";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createClient();

  const [
    posterUrl,
    endDate,
    genre,
    duration,
    ageRestriction,
    ticketOpenDate,
    ticketProvider,
    noticeText,
    allTitles,
  ] = await Promise.all([
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .or("poster_url.is.null,poster_url.eq."),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .is("end_date", null),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .or("genre.is.null,genre.eq."),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .or("duration.is.null,duration.eq."),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .or("age_restriction.is.null,age_restriction.eq."),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .is("ticket_open_date", null),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .or("ticket_provider.is.null,ticket_provider.eq."),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .or("notice_text.is.null,notice_text.eq."),
    supabase.from("events").select("title"),
  ]);

  const titleCounts: Record<string, number> = {};
  for (const row of allTitles.data ?? []) {
    titleCounts[row.title] = (titleCounts[row.title] ?? 0) + 1;
  }
  const duplicateCount = Object.values(titleCounts)
    .filter((c) => c > 1)
    .reduce((sum, c) => sum + c, 0);

  return NextResponse.json({
    missingCounts: {
      poster_url: posterUrl.count ?? 0,
      end_date: endDate.count ?? 0,
      genre: genre.count ?? 0,
      duration: duration.count ?? 0,
      age_restriction: ageRestriction.count ?? 0,
      ticket_open_date: ticketOpenDate.count ?? 0,
      ticket_provider: ticketProvider.count ?? 0,
      notice_text: noticeText.count ?? 0,
    },
    duplicateCount,
  });
}
