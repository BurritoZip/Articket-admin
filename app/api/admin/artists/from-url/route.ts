import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { parseArtistDetailPage } from "@/lib/scrapers/stagepick/parser";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const FETCH_HEADERS = {
  Referer: "https://www.stagepick.co.kr/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const ARTIST_SELECT =
  "id, name, avatar_url, followers_count, upcoming_event_count, occupation, birth_date, birth_place, related";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as { url?: string };
  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "url_required" }, { status: 400 });
  }

  let html: string;
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    return NextResponse.json(
      { error: "fetch_failed", detail: String(e) },
      { status: 502 },
    );
  }

  const profile = parseArtistDetailPage(html, url);
  if (!profile.name?.trim()) {
    return NextResponse.json(
      { error: "parse_failed", detail: "아티스트 이름을 찾을 수 없습니다." },
      { status: 422 },
    );
  }

  const db = createServiceRoleClient();

  const { data: existing } = await db
    .from("artists")
    .select(ARTIST_SELECT)
    .ilike("name", profile.name.trim())
    .maybeSingle();

  if (existing) {
    const ex = existing as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (!ex.avatar_url && profile.avatarUrl) patch.avatar_url = profile.avatarUrl;
    if (!ex.occupation && profile.occupation) patch.occupation = profile.occupation;
    if (!ex.birth_date && profile.birthDate) patch.birth_date = profile.birthDate;
    if (!ex.related && profile.related) patch.related = profile.related;

    if (Object.keys(patch).length > 0) {
      await db.from("artists").update(patch).eq("id", ex.id as string);
    }

    const { data: updated } = await db
      .from("artists")
      .select(ARTIST_SELECT)
      .eq("id", ex.id as string)
      .single();

    return NextResponse.json({ action: "updated", artist: updated });
  }

  const { data: inserted, error } = await db
    .from("artists")
    .insert({
      name: profile.name.trim(),
      avatar_url: profile.avatarUrl ?? null,
      occupation: profile.occupation ?? null,
      birth_date: profile.birthDate ?? null,
      related: profile.related ?? null,
      followers_count: 0,
      upcoming_event_count: 0,
    })
    .select(ARTIST_SELECT)
    .single();

  if (error) {
    return NextResponse.json(
      { error: "create_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ action: "created", artist: inserted });
}
