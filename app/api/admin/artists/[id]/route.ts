import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { ArtistIngestionSchema, emptyToNull } from "@/lib/ingestion/schemas";
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
      .from("artist_albums")
      .select("id, artist_id, title, cover_url, released_year")
      .eq("artist_id", params.id)
      .order("released_year", { ascending: false }),
    supabase
      .from("artist_music_videos")
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

  if (body.artist?.name !== undefined) {
    const result = ArtistIngestionSchema.partial().safeParse({
      name: body.artist.name,
      avatar_url: body.artist.avatar_url,
    });
    if (!result.success) {
      return NextResponse.json(
        {
          error: "validation_failed",
          details: result.error.errors.map((e) => e.message),
        },
        { status: 422 },
      );
    }
  }

  const supabase = createServiceRoleClient();

  // 편집 가능한 컬럼만 화이트리스트. id(PK)·followers_count·upcoming_event_count
  // (트리거 관리 카운터)는 폼이 스테일 값으로 실어보내므로 제외한다.
  const ARTIST_EDITABLE = [
    "name",
    "avatar_url",
    "occupation",
    "birth_date",
    "birth_place",
    "related",
    "label",
    "country",
    "sns_links",
  ] as const;

  if (body.artist) {
    const patch: Record<string, unknown> = {};
    for (const key of ARTIST_EDITABLE) {
      if (key in body.artist) {
        patch[key] = emptyToNull((body.artist as Record<string, unknown>)[key]);
      }
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase
        .from("artists")
        .update(patch)
        .eq("id", params.id);
      if (error) {
        return NextResponse.json(
          { error: "artist_update_failed", detail: error.message },
          { status: 400 },
        );
      }
    }
  }

  // albums/videos 는 replace_artist_children RPC 로 트랜잭션 안에서 교체한다.
  // (기존엔 DELETE 후 INSERT 를 비트랜잭션으로 해서, INSERT 실패 시 자식행이 영구 소실됐다.)
  // undefined = 해당 종류 미전송 → 건드리지 않음. 빈 배열 = 전부 비움.
  if (body.albums !== undefined || body.videos !== undefined) {
    const albums =
      body.albums === undefined
        ? null
        : body.albums
            .filter((a) => a.title && a.title.trim())
            .map((a) => ({
              title: a.title!.trim(),
              cover_url: emptyToNull(a.cover_url ?? null),
              released_year: emptyToNull(a.released_year ?? null),
            }));
    const videos =
      body.videos === undefined
        ? null
        : body.videos
            .filter((v) => v.title && v.title.trim())
            .map((v) => ({
              title: v.title!.trim(),
              thumbnail_url: emptyToNull(v.thumbnail_url ?? null),
              view_count: v.view_count ?? null,
              like_count: v.like_count ?? null,
              uploaded_at: emptyToNull(v.uploaded_at ?? null),
            }));

    const { error } = await supabase.rpc("replace_artist_children", {
      p_artist_id: params.id,
      p_albums: albums,
      p_videos: videos,
    });
    if (error) {
      return NextResponse.json(
        { error: "children_save_failed", detail: error.message },
        { status: 400 },
      );
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
