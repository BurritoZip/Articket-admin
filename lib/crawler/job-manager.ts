import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { CrawlerJob, CrawlerJobStatus } from "@/types/crawler";

export async function createCrawlerJob(sourceName: string): Promise<CrawlerJob> {
  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("crawler_jobs")
    .insert({ source_name: sourceName, status: "running", started_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw new Error(`Failed to create crawler job: ${error.message}`);
  return data as CrawlerJob;
}

export async function updateCrawlerJob(
  jobId: string,
  patch: Partial<{
    status: CrawlerJobStatus;
    finished_at: string;
    pages_crawled: number;
    events_found: number;
    events_upserted: number;
    events_skipped: number;
    error_count: number;
    meta: Record<string, unknown>;
  }>,
): Promise<void> {
  const db = createServiceRoleClient();
  const { error } = await db.from("crawler_jobs").update(patch).eq("id", jobId);
  if (error) throw new Error(`Failed to update crawler job: ${error.message}`);
}

export async function finishCrawlerJob(
  jobId: string,
  stats: {
    status: CrawlerJobStatus;
    pagesCrawled: number;
    eventsFound: number;
    eventsUpserted: number;
    eventsSkipped: number;
    errorCount: number;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await updateCrawlerJob(jobId, {
    status: stats.status,
    finished_at: new Date().toISOString(),
    pages_crawled: stats.pagesCrawled,
    events_found: stats.eventsFound,
    events_upserted: stats.eventsUpserted,
    events_skipped: stats.eventsSkipped,
    error_count: stats.errorCount,
    ...(stats.meta ? { meta: stats.meta } : {}),
  });
}

export async function saveRawPayload(params: {
  jobId: string;
  sourceName: string;
  sourceUrl: string;
  rawHtml?: string | null;
  parsedJson?: Record<string, unknown> | null;
  dedupKey?: string | null;
}): Promise<string> {
  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("raw_event_payloads")
    .insert({
      job_id: params.jobId,
      source_name: params.sourceName,
      source_url: params.sourceUrl,
      raw_html: params.rawHtml ?? null,
      parsed_json: params.parsedJson ?? null,
      dedup_key: params.dedupKey ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to save raw payload: ${error.message}`);
  return (data as { id: string }).id;
}

export async function markRawPayloadProcessed(rawPayloadId: string, eventId: string): Promise<void> {
  const db = createServiceRoleClient();
  await db
    .from("raw_event_payloads")
    .update({ processed: true, event_id: eventId })
    .eq("id", rawPayloadId);
}

export async function listCrawlerJobs(limit = 20): Promise<CrawlerJob[]> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("crawler_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as CrawlerJob[];
}
