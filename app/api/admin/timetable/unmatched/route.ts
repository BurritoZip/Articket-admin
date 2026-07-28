import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { withErrorHandler } from "@/lib/api-handler";
import {
  buildPaginationMeta,
  parseAdminPagination,
} from "@/lib/admin-pagination";
import {
  matchExistingArtist,
  normalizeArtistName,
} from "@/lib/ingestion/artist-matcher";

// 타임테이블 임포트 시 기존 아티스트 리스트에 매칭 안 된 이름 로그 조회
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status")?.trim() ?? "unresolved";
  const { page, pageSize } = parseAdminPagination(url.searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("timetable_unmatched_artists")
    .select(
      "id, event_id, event_title, artist_name, stage_name, day_number, source, is_resolved, created_at, events(id, title)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q) query = query.ilike("artist_name", `%${q}%`);
  if (status === "unresolved") query = query.eq("is_resolved", false);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data: data ?? [],
    meta: buildPaginationMeta(page, pageSize, count ?? 0),
  });
}

// 미매칭 로그 해결 표시 (운영자가 별칭 추가/신규 생성/무시 후 처리 완료)
export const PATCH = withErrorHandler(async (request: Request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    id?: string;
    is_resolved?: boolean;
  };
  if (!body.id || typeof body.is_resolved !== "boolean") {
    return NextResponse.json(
      { error: "id 와 is_resolved(boolean) 필요" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("timetable_unmatched_artists")
    .update({ is_resolved: body.is_resolved })
    .eq("id", body.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});

// 미매칭 처리: 기존 연결 / 신규 생성 후 연결 / 이름 수정 재매칭 / 삭제
export const POST = withErrorHandler(async (request: Request) => {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    action?: "link" | "create" | "rename" | "delete";
    logId?: string;
    artistId?: string;
    name?: string;
    newName?: string;
  };
  const { action, logId } = body;
  if (!logId || !action) {
    return NextResponse.json(
      { error: "action 과 logId 필요" },
      { status: 400 },
    );
  }

  const db = createServiceRoleClient();

  const { data: log, error: logErr } = await db
    .from("timetable_unmatched_artists")
    .select("id, event_id, artist_name")
    .eq("id", logId)
    .maybeSingle();
  if (logErr) {
    return NextResponse.json({ error: logErr.message }, { status: 500 });
  }
  if (!log) {
    return NextResponse.json(
      { error: "로그를 찾을 수 없습니다." },
      { status: 404 },
    );
  }
  const eventId = (log as { event_id: string | null }).event_id;
  const currentName = (log as { artist_name: string }).artist_name;

  // 대상 performance 행 갱신 헬퍼 (event_id + 원문명 + artist_id null)
  const updatePerformances = async (patch: Record<string, unknown>) => {
    if (!eventId) return { error: null };
    const { error } = await db
      .from("timetable_performances")
      .update(patch)
      .eq("event_id", eventId)
      .eq("artist_name", currentName)
      .is("artist_id", null);
    return { error };
  };

  if (action === "delete") {
    if (eventId) {
      const { error: delPerfErr } = await db
        .from("timetable_performances")
        .delete()
        .eq("event_id", eventId)
        .eq("artist_name", currentName)
        .is("artist_id", null);
      if (delPerfErr) {
        return NextResponse.json(
          { error: delPerfErr.message },
          { status: 500 },
        );
      }
    }
    const { error: delLogErr } = await db
      .from("timetable_unmatched_artists")
      .delete()
      .eq("id", logId);
    if (delLogErr) {
      return NextResponse.json({ error: delLogErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "rename") {
    const newName = body.newName?.trim();
    if (!newName) {
      return NextResponse.json({ error: "newName 필요" }, { status: 400 });
    }
    const artistId = await matchExistingArtist(newName);
    if (artistId) {
      const { data: art } = await db
        .from("artists")
        .select("name")
        .eq("id", artistId)
        .maybeSingle();
      const canonical = (art as { name: string } | null)?.name ?? newName;
      const { error: updPerfErr } = await updatePerformances({
        artist_id: artistId,
        artist_name: canonical,
      });
      if (updPerfErr) {
        return NextResponse.json(
          { error: updPerfErr.message },
          { status: 500 },
        );
      }
      const { error: updLogErr } = await db
        .from("timetable_unmatched_artists")
        .update({ artist_name: canonical, is_resolved: true })
        .eq("id", logId);
      if (updLogErr) {
        return NextResponse.json({ error: updLogErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, matched: true });
    }
    // 매칭 실패 → 이름만 갱신, 미해결 유지
    const { error: updPerfErr2 } = await updatePerformances({
      artist_name: newName,
    });
    if (updPerfErr2) {
      return NextResponse.json({ error: updPerfErr2.message }, { status: 500 });
    }
    const { error: updLogErr2 } = await db
      .from("timetable_unmatched_artists")
      .update({ artist_name: newName, is_resolved: false })
      .eq("id", logId);
    if (updLogErr2) {
      return NextResponse.json({ error: updLogErr2.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, matched: false });
  }

  // link / create → artistId + 정식명 결정
  let artistId: string | undefined = body.artistId;
  let canonical: string;
  if (action === "create") {
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "name 필요" }, { status: 400 });
    }
    const existingId = await matchExistingArtist(name);
    if (existingId) {
      const { data: art } = await db
        .from("artists")
        .select("name")
        .eq("id", existingId)
        .maybeSingle();
      artistId = existingId;
      canonical = (art as { name: string } | null)?.name ?? name;
    } else {
      const { data: created, error: cErr } = await db
        .from("artists")
        .insert({ name, normalized_name: normalizeArtistName(name) })
        .select("id, name")
        .single();
      if (cErr) {
        return NextResponse.json({ error: cErr.message }, { status: 500 });
      }
      artistId = (created as { id: string }).id;
      canonical = (created as { name: string }).name;
    }
  } else if (action === "link") {
    if (!artistId) {
      return NextResponse.json({ error: "artistId 필요" }, { status: 400 });
    }
    const { data: art } = await db
      .from("artists")
      .select("name")
      .eq("id", artistId)
      .maybeSingle();
    if (!art) {
      return NextResponse.json(
        { error: "아티스트를 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    canonical = (art as { name: string }).name;
  } else {
    return NextResponse.json({ error: "알 수 없는 action" }, { status: 400 });
  }

  const { error: updPerfErr3 } = await updatePerformances({
    artist_id: artistId,
    artist_name: canonical,
  });
  if (updPerfErr3) {
    return NextResponse.json({ error: updPerfErr3.message }, { status: 500 });
  }
  const { error: updLogErr3 } = await db
    .from("timetable_unmatched_artists")
    .update({ is_resolved: true })
    .eq("id", logId);
  if (updLogErr3) {
    return NextResponse.json({ error: updLogErr3.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
