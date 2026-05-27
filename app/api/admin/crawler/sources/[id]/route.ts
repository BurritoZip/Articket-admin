/**
 * PATCH /api/admin/crawler/sources/[id]
 * 소스 활성화 토글 또는 config(selectors, rateLimit 등) 업데이트
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { CrawlerSourceConfig } from "@/types/crawler";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const body = (await request.json()) as {
    enabled?: boolean;
    config?: Partial<CrawlerSourceConfig>;
  };

  const db = createServiceRoleClient();

  // 현재 소스 조회
  const { data: existing, error: fetchErr } = await db
    .from("crawler_sources")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json(
      { error: "소스를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const patch: Record<string, unknown> = {};

  if (body.enabled !== undefined) {
    patch.enabled = body.enabled;
  }

  if (body.config !== undefined) {
    // 기존 config와 병합 (덮어쓰기 방지)
    const existingConfig = existing.config as CrawlerSourceConfig;
    patch.config = {
      ...existingConfig,
      ...body.config,
      // selectors는 키 단위로 병합
      ...(body.config.selectors
        ? {
            selectors: {
              ...(existingConfig.selectors ?? {}),
              ...body.config.selectors,
            },
          }
        : {}),
    };
  }

  const { data: updated, error: updateErr } = await db
    .from("crawler_sources")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, source: updated });
}
