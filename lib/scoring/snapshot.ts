import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { ScoreBreakdown } from "@/types/scoring";
import { fetchAll } from "./util";

export interface SnapshotResult {
  artistRows: number;
  eventRows: number;
}

interface ScoredRow {
  id: string;
  popularity_score: number | null;
  score_breakdown: ScoreBreakdown | null;
}

function signalsOf(breakdown: ScoreBreakdown | null): Record<string, number> {
  if (!breakdown?.signals) return {};
  return Object.fromEntries(breakdown.signals.map((s) => [s.key, s.raw]));
}

/** 갓 계산된 점수+원시 신호를 popularity_snapshots에 entity별 1행 기록 (트렌드용 히스토리) */
export async function captureSnapshots(): Promise<SnapshotResult> {
  const db = createServiceRoleClient();
  const capturedAt = new Date().toISOString();

  const [artists, events] = await Promise.all([
    fetchAll<ScoredRow>((f, t) =>
      db
        .from("artists")
        .select("id,popularity_score,score_breakdown")
        .not("popularity_score", "is", null)
        .range(f, t),
    ),
    fetchAll<ScoredRow>((f, t) =>
      db
        .from("events")
        .select("id,popularity_score,score_breakdown")
        .not("popularity_score", "is", null)
        .range(f, t),
    ),
  ]);

  const rows = [
    ...artists.map((a) => ({
      entity_type: "artist" as const,
      entity_id: a.id,
      signals: signalsOf(a.score_breakdown),
      popularity_score: a.popularity_score,
      captured_at: capturedAt,
    })),
    ...events.map((e) => ({
      entity_type: "event" as const,
      entity_id: e.id,
      signals: signalsOf(e.score_breakdown),
      popularity_score: e.popularity_score,
      captured_at: capturedAt,
    })),
  ];

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from("popularity_snapshots").insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
  }

  return { artistRows: artists.length, eventRows: events.length };
}
