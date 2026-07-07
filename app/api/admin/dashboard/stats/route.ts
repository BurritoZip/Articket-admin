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
    { data: enrichmentRows },
    { data: queueRows },
    { data: recentJobs },
    { data: fixLogs },
    { count: errorLogsUnresolved },
    { count: timetableUnmatchedUnresolved },
  ] = await Promise.all([
    supabase
      .from("events")
      .select("id,title,status,end_date,artist_id,ticket_open_date"),
    supabase.from("artists").select("id", { count: "exact", head: true }),
    supabase.from("venues").select("id", { count: "exact", head: true }),
    serviceClient.from("users").select("id", { count: "exact", head: true }),
    serviceClient.from("artists").select("enrichment_status").limit(10000),
    serviceClient
      .from("ai_processing_queue")
      .select("status,task_type")
      .limit(5000),
    serviceClient
      .from("crawler_jobs")
      .select(
        "id,source_name,status,finished_at,events_found,events_upserted,meta",
      )
      .order("finished_at", { ascending: false })
      .limit(5),
    serviceClient
      .from("data_quality_fix_logs")
      .select("fix_method,fixed_at")
      .gte("fixed_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .limit(1000),
    serviceClient
      .from("app_error_logs")
      .select("id", { count: "exact", head: true })
      .eq("is_resolved", false),
    serviceClient
      .from("timetable_unmatched_artists")
      .select("id", { count: "exact", head: true })
      .eq("is_resolved", false),
  ]);

  const allEvents = events ?? [];
  const today_dt = new Date().toISOString();

  const eventStats = {
    total: allEvents.length,
    upcoming: allEvents.filter((e) => e.status === "upcoming").length,
    on_sale: allEvents.filter((e) => e.status === "on_sale").length,
    ongoing: allEvents.filter((e) => e.status === "ongoing").length,
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

  // 보강 현황
  const enrichRows = (enrichmentRows ?? []) as Array<{
    enrichment_status: string | null;
  }>;
  const enrichment = {
    enriched: enrichRows.filter((r) => r.enrichment_status === "enriched")
      .length,
    pending: enrichRows.filter(
      (r) => !r.enrichment_status || r.enrichment_status === "pending",
    ).length,
    skipped: enrichRows.filter((r) => r.enrichment_status === "skipped").length,
    failed: enrichRows.filter((r) => r.enrichment_status === "failed").length,
  };

  // AI 큐 현황
  const qRows = (queueRows ?? []) as Array<{
    status: string;
    task_type: string;
  }>;
  const queue = {
    pending: qRows.filter((r) => r.status === "pending").length,
    processing: qRows.filter((r) => r.status === "processing").length,
    done: qRows.filter((r) => r.status === "done").length,
    failed: qRows.filter((r) => r.status === "failed").length,
  };

  // 최근 크롤러 작업
  const jobs = (recentJobs ?? []).map((j) => ({
    id: j.id as string,
    source: j.source_name as string,
    status: j.status as string,
    finishedAt: j.finished_at as string | null,
    eventsFound: (j.events_found as number) ?? 0,
    eventsUpserted: (j.events_upserted as number) ?? 0,
  }));

  // 최근 7일 품질 수정 통계
  const logs = (fixLogs ?? []) as Array<{ fix_method: string }>;
  const qualityFixes = {
    nulled: logs.filter((l) => l.fix_method === "null_field").length,
    queued: logs.filter((l) => l.fix_method === "queued_ai").length,
    deleted: logs.filter((l) => l.fix_method === "deleted").length,
  };

  return NextResponse.json({
    events: eventStats,
    artists: { total: artistCount ?? 0 },
    venues: { total: venueCount ?? 0 },
    users: { total: userCount ?? 0 },
    ticket_opens_soon: ticketOpensSoon,
    unlinked_events: unlinkedEvents,
    enrichment,
    queue,
    recent_jobs: jobs,
    quality_fixes_7d: qualityFixes,
    app_errors_unresolved: errorLogsUnresolved ?? 0,
    timetable_unmatched_unresolved: timetableUnmatchedUnresolved ?? 0,
  });
}
