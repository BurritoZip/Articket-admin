import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import type { AlbumRow, ArtistRow, MusicVideoRow } from "@/types/artist";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createClient();
  const [artistRes, albumsRes, videosRes] = await Promise.all([
    supabase
      .from("artists")
      .select(
        "id, name, avatar_url, followers_count, upcoming_event_count, occupation, birth_date, birth_place, related, label, country, sns_links",
      )
      .eq("id", params.id)
      .maybeSingle(),
    supabase
      .from("albums")
      .select("id, artist_id, title, cover_url, released_year")
      .eq("artist_id", params.id)
      .order("released_year", { ascending: false }),
    supabase
      .from("music_videos")
      .select(
        "id, artist_id, title, thumbnail_url, view_count, like_count, uploaded_at",
      )
      .eq("artist_id", params.id)
      .order("uploaded_at", { ascending: false }),
  ]);

  if (artistRes.error || !artistRes.data) {
    return NextResponse.json(
      { error: "artist_not_found", detail: artistRes.error?.message },
      { status: 404 },
    );
  }

  return NextResponse.json({
    artist: artistRes.data as ArtistRow,
    albums: (albumsRes.data ?? []) as AlbumRow[],
    videos: (videosRes.data ?? []) as MusicVideoRow[],
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as {
    artist?: Partial<ArtistRow>;
    albums?: Array<Partial<AlbumRow>>;
    videos?: Array<Partial<MusicVideoRow>>;
  };

  const supabase = createServiceRoleClient();

  if (body.artist) {
    const { error } = await supabase
      .from("artists")
      .update(body.artist)
      .eq("id", params.id);
    if (error) {
      return NextResponse.json(
        { error: "artist_update_failed", detail: error.message },
        { status: 400 },
      );
    }
  }

  if (body.albums) {
    // 단순 전략: 기존 앨범 삭제 후 재삽입
    const del = await supabase
      .from("albums")
      .delete()
      .eq("artist_id", params.id);
    if (del.error) {
      return NextResponse.json(
        { error: "albums_delete_failed", detail: del.error.message },
        { status: 400 },
      );
    }

    const insertRows = body.albums
      .filter((a) => a.title && a.title.trim())
      .map((a) => ({
        artist_id: params.id,
        title: a.title?.trim() ?? "",
        cover_url: a.cover_url ?? null,
        released_year: a.released_year ?? null,
      }));

    if (insertRows.length > 0) {
      const ins = await supabase.from("albums").insert(insertRows);
      if (ins.error) {
        return NextResponse.json(
          { error: "albums_insert_failed", detail: ins.error.message },
          { status: 400 },
        );
      }
    }
  }

  if (body.videos) {
    const del = await supabase
      .from("music_videos")
      .delete()
      .eq("artist_id", params.id);
    if (del.error) {
      return NextResponse.json(
        { error: "videos_delete_failed", detail: del.error.message },
        { status: 400 },
      );
    }

    const insertRows = body.videos
      .filter((v) => v.title && v.title.trim())
      .map((v) => ({
        artist_id: params.id,
        title: v.title?.trim() ?? "",
        thumbnail_url: v.thumbnail_url ?? null,
        view_count: v.view_count ?? null,
        like_count: v.like_count ?? null,
        uploaded_at: v.uploaded_at ?? null,
      }));

    if (insertRows.length > 0) {
      const ins = await supabase.from("music_videos").insert(insertRows);
      if (ins.error) {
        return NextResponse.json(
          { error: "videos_insert_failed", detail: ins.error.message },
          { status: 400 },
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("artists").delete().eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { error: "delete_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
