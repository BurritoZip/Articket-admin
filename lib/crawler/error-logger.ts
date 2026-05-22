import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { IngestionStep } from "@/types/crawler";

interface LogErrorParams {
  jobId?: string | null;
  sourceName: string;
  sourceUrl?: string | null;
  step: IngestionStep;
  error: unknown;
  rawPayload?: Record<string, unknown> | null;
}

export async function logIngestionError(params: LogErrorParams): Promise<void> {
  const err = params.error instanceof Error ? params.error : new Error(String(params.error));
  try {
    const db = createServiceRoleClient();
    await db.from("ingestion_errors").insert({
      job_id: params.jobId ?? null,
      source_name: params.sourceName,
      source_url: params.sourceUrl ?? null,
      step: params.step,
      error_type: err.name,
      error_message: err.message,
      stack_trace: err.stack ?? null,
      raw_payload: params.rawPayload ?? null,
    });
  } catch {
    // never throw from error logger
    console.error("[IngestionErrorLogger] failed to persist error", err.message);
  }
}

export async function logCrawlError(
  jobId: string,
  sourceName: string,
  sourceUrl: string,
  error: unknown,
): Promise<void> {
  await logIngestionError({ jobId, sourceName, sourceUrl, step: "crawl", error });
}

export async function logParseError(
  jobId: string,
  sourceName: string,
  sourceUrl: string,
  error: unknown,
  rawPayload?: Record<string, unknown>,
): Promise<void> {
  await logIngestionError({ jobId, sourceName, sourceUrl, step: "parse", error, rawPayload });
}

export async function logUpsertError(
  jobId: string,
  sourceName: string,
  error: unknown,
  rawPayload?: Record<string, unknown>,
): Promise<void> {
  await logIngestionError({ jobId, sourceName, step: "upsert", error, rawPayload });
}
