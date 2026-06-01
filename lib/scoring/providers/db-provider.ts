import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fetchAll } from "../util";
import type { ArtistSignalProvider, ArtistSignals } from "./types";

interface ArtistBaseRow {
  id: string;
  followers_count: number | null;
  upcoming_event_count: number | null;
}

interface ArtistAggRow {
  artist_id: string;
  follower_graph_count: number | null;
  event_bookmark_total: number | null;
  review_volume: number | null;
  review_avg: number | null;
}

/**
 * 내부 DB 신호 provider.
 * artists 베이스 컬럼 + artist_engagement_agg 뷰(앱 내 팔로우/북마크/리뷰)를 배치로 읽음.
 */
export const dbArtistSignalProvider: ArtistSignalProvider = {
  name: "db",
  async fetch(): Promise<Map<string, ArtistSignals>> {
    const db = createServiceRoleClient();

    const [base, agg] = await Promise.all([
      fetchAll<ArtistBaseRow>((f, t) =>
        db.from("artists").select("id,followers_count,upcoming_event_count").range(f, t),
      ),
      fetchAll<ArtistAggRow>((f, t) =>
        db
          .from("artist_engagement_agg")
          .select(
            "artist_id,follower_graph_count,event_bookmark_total,review_volume,review_avg",
          )
          .range(f, t),
      ),
    ]);

    const aggById = new Map(agg.map((r) => [r.artist_id, r]));
    const out = new Map<string, ArtistSignals>();

    for (const a of base) {
      const e = aggById.get(a.id);
      out.set(a.id, {
        followers_count: a.followers_count ?? 0,
        upcoming_event_count: a.upcoming_event_count ?? 0,
        follower_graph_count: e?.follower_graph_count ?? 0,
        event_bookmark_total: e?.event_bookmark_total ?? 0,
        review_volume: e?.review_volume ?? 0,
        review_avg: e?.review_avg ?? 0,
      });
    }
    return out;
  },
};
