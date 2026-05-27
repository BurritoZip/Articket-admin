import { requireAdmin } from "@/lib/supabase/require-admin";
import {
  enrichArtist,
  processArtistEnrichmentQueue,
  type EnrichSource,
} from "@/lib/artists/enrich";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withErrorHandler } from "@/lib/api-handler";
import { NextResponse } from "next/server";

export const maxDuration = 300;

type SingleBody = {
  mode: "single";
  artistId: string;
  sources?: EnrichSource[];
  force?: boolean;
};

type BatchBody = {
  mode: "batch";
  filter?: {
    missing?: string[];
    status?: string;
    limit?: number;
  };
  sources?: EnrichSource[];
  force?: boolean;
};

type QueueBody = {
  mode: "queue";
  filter?: {
    missing?: string[];
    status?: string;
    limit?: number;
  };
};

type EnrichBody = SingleBody | BatchBody | QueueBody;

export const POST = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as EnrichBody;

  // ── 단일 보강 ─────────────────────────────────────────────────
  if (body.mode === "single") {
    const { artistId, sources, force } = body;
    if (!artistId) {
      return NextResponse.json({ error: "artistId 필수" }, { status: 400 });
    }
    const delta = await enrichArtist(artistId, { sources, force });
    return NextResponse.json({ ok: true, delta });
  }

  // ── 배치 보강 (직접 실행, limit 100) ─────────────────────────
  if (body.mode === "batch") {
    const { filter, sources, force } = body;
    const limit = Math.min(filter?.limit ?? 20, 100);

    const db = createServiceRoleClient();
    let query = db.from("artists").select("id,name").limit(limit);

    // missing 필드 필터
    if (filter?.missing && filter.missing.length > 0) {
      const conditions = filter.missing
        .map((f) => `${f}.is.null,${f}.eq.`)
        .join(",");
      query = query.or(conditions);
    }

    // enrichment_status 필터
    if (filter?.status) {
      query = query.eq("enrichment_status", filter.status);
    }

    const { data: artists } = await query;
    if (!artists || artists.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, results: [] });
    }

    const results = [];
    for (const artist of artists) {
      try {
        const delta = await enrichArtist(artist.id, { sources, force });
        results.push({
          artistId: artist.id,
          name: artist.name,
          ok: true,
          delta,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({
          artistId: artist.id,
          name: artist.name,
          ok: false,
          error: msg,
        });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    return NextResponse.json({
      ok: true,
      processed: artists.length,
      succeeded,
      results,
    });
  }

  // ── 큐 적재 (비동기, ai_processing_queue에 등록) ──────────────
  if (body.mode === "queue") {
    const { filter } = body;
    const limit = Math.min(filter?.limit ?? 500, 2000);

    const db = createServiceRoleClient();
    let query = db.from("artists").select("id,name").limit(limit);

    if (filter?.missing && filter.missing.length > 0) {
      // missing 필드 기준으로만 선택 — enrichment_status 무관하게
      // (enriched/skipped여도 데이터가 여전히 없으면 재시도)
      const conditions = filter.missing
        .map((f) => `${f}.is.null,${f}.eq.`)
        .join(",");
      query = query.or(conditions);
    } else {
      // missing 필터 없으면 status 기반으로 fallback
      query = query.or(
        "enrichment_status.is.null,enrichment_status.eq.pending,enrichment_status.eq.failed,enrichment_status.eq.skipped",
      );
    }

    const { data: artists } = await query;
    if (!artists || artists.length === 0) {
      return NextResponse.json({ ok: true, queued: 0 });
    }

    const artistIds = artists.map((a) => a.id);

    // 큐에 다시 넣기 전에 enrichment_status를 'pending'으로 리셋
    // (skipped/enriched→pending으로 바꿔야 워커가 재시도함)
    await db
      .from("artists")
      .update({ enrichment_status: "pending" })
      .in("id", artistIds);

    const tasks = artists.map((a) => ({
      task_type: "clean_data",
      status: "pending",
      priority: 4,
      entity_type: "artist",
      entity_id: a.id,
      payload: {
        target: "artist_profile_enrichment",
        artistId: a.id,
        artistName: a.name,
      },
    }));

    const { error } = await db
      .from("ai_processing_queue")
      .upsert(tasks, { onConflict: "entity_id,task_type" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, queued: tasks.length });
  }

  return NextResponse.json({ error: "올바르지 않은 mode" }, { status: 400 });
});

/** 큐 워커 — cron에서 호출 */
export const GET = withErrorHandler(async (request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const maxItems = Math.min(
    parseInt(url.searchParams.get("limit") ?? "20"),
    50,
  );

  const result = await processArtistEnrichmentQueue(maxItems);
  return NextResponse.json({ ok: true, ...result });
});
