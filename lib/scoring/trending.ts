import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { SCORING_WEIGHTS } from "./config";
import { applyScores, fetchAll, round2 } from "./util";

export interface TrendingResult {
  artistsUpdated: number;
  eventsUpdated: number;
  coldStart: number;
}

interface SnapshotRow {
  entity_type: "artist" | "event";
  entity_id: string;
  popularity_score: number | null;
  captured_at: string;
}

const avg = (xs: number[]) =>
  xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : 0;

/**
 * trending = 최근7일 평균 / 이전30일 평균 × 100 (100=보합, >100=상승).
 * baseline 스냅샷이 minSnapshotsForTrend 미만이면 콜드스타트 → 0.
 */
export async function computeTrendingScores(): Promise<TrendingResult> {
  const db = createServiceRoleClient();
  const { currentWindowDays, baselineWindowDays, minSnapshotsForTrend } =
    SCORING_WEIGHTS.trending;

  const now = Date.now();
  const baselineCutoff = new Date(
    now - baselineWindowDays * 86_400_000,
  ).toISOString();
  const currentCutoff = now - currentWindowDays * 86_400_000;

  const snapshots = await fetchAll<SnapshotRow>((f, t) =>
    db
      .from("popularity_snapshots")
      .select("entity_type,entity_id,popularity_score,captured_at")
      .gte("captured_at", baselineCutoff)
      .range(f, t),
  );

  // entity별 그룹
  const byEntity = new Map<
    string,
    { type: "artist" | "event"; baseline: number[]; current: number[] }
  >();
  for (const s of snapshots) {
    const score = s.popularity_score ?? 0;
    const key = `${s.entity_type}:${s.entity_id}`;
    const g = byEntity.get(key) ?? {
      type: s.entity_type,
      baseline: [],
      current: [],
    };
    g.baseline.push(score);
    if (new Date(s.captured_at).getTime() >= currentCutoff)
      g.current.push(score);
    byEntity.set(key, g);
  }

  const artistUpdates: Record<string, unknown>[] = [];
  const eventUpdates: Record<string, unknown>[] = [];
  let coldStart = 0;

  for (const [key, g] of Array.from(byEntity)) {
    const entityId = key.slice(key.indexOf(":") + 1);
    let trending = 0;
    if (g.baseline.length < minSnapshotsForTrend) {
      coldStart++;
    } else {
      const base = avg(g.baseline);
      trending = base > 0 ? round2((avg(g.current) / base) * 100) : 0;
    }
    const row = { id: entityId, trending_score: trending };
    if (g.type === "artist") artistUpdates.push(row);
    else eventUpdates.push(row);
  }

  await applyScores(db, "apply_artist_scores", artistUpdates);
  await applyScores(db, "apply_event_scores", eventUpdates);

  return {
    artistsUpdated: artistUpdates.length,
    eventsUpdated: eventUpdates.length,
    coldStart,
  };
}
