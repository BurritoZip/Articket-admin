import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { differenceInCalendarDays, parseISO } from "date-fns";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createClient();
  const serviceClient = createServiceRoleClient();
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: events },
    { count: artistCount },
    { count: venueCount },
    { count: userCount },
  ] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, status, end_date, artist_id, ticket_open_date"),
    supabase.from("artists").select("id", { count: "exact", head: true }),
    supabase.from("venues").select("id", { count: "exact", head: true }),
    serviceClient.from("users").select("id", { count: "exact", head: true }),
  ]);

  const allEvents = events ?? [];

  const eventStats = {
    total: allEvents.length,
    upcoming: allEvents.filter((e) => e.status === "upcoming").length,
    on_sale: allEvents.filter((e) => e.status === "on_sale").length,
    ended: allEvents.filter((e) => e.status === "ended").length,
    needs_end_update: allEvents.filter(
      (e) => e.end_date && e.end_date < today && e.status !== "ended",
    ).length,
  };

  const ticketOpensSoon = allEvents
    .filter((e) => {
      if (!e.ticket_open_date) return false;
      const diff = differenceInCalendarDays(
        parseISO(e.ticket_open_date),
        new Date(),
      );
      return diff >= 0 && diff <= 7;
    })
    .map((e) => ({
      id: e.id,
      title: e.title,
      ticket_open_date: e.ticket_open_date!,
      d_day: differenceInCalendarDays(
        parseISO(e.ticket_open_date!),
        new Date(),
      ),
    }))
    .sort((a, b) => a.d_day - b.d_day);

  const unlinkedEvents = allEvents.filter((e) => !e.artist_id).length;

  return NextResponse.json({
    events: eventStats,
    artists: { total: artistCount ?? 0 },
    venues: { total: venueCount ?? 0 },
    users: { total: userCount ?? 0 },
    ticket_opens_soon: ticketOpensSoon,
    unlinked_events: unlinkedEvents,
  });
}
