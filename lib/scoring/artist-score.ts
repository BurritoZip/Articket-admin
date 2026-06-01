import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { ScoreBreakdown, ScoreSignalEntry } from "@/types/scoring";
import { SCORING_WEIGHTS } from "./config";
import { normalizeSignal, type NormalizeResult } from "./normalize";
import { collectArtistSignals } from "./providers";
import { applyScores, fetchAll, formatNum, round2 } from "./util";

export interface ArtistScoreResult {
  scored: number;
  lowConfidence: number;
}

function reasonFor(label: string, raw: number, norm: NormalizeResult): string {
  if (norm.method === "percentile") {
    const top = Math.max(1, Math.round(100 - norm.normalized));
    return `${label} 상위 ${top}% (${formatNum(raw)})`;
  }
  return `${label} ${formatNum(raw)}`;
}

export async function computeArtistPopularityScores(): Promise<ArtistScoreResult> {
  const db = createServiceRoleClient();

  const artists = await fetchAll<{ id: string }>((f, t) =>
    db.from("artists").select("id").range(f, t),
  );
  const ids = artists.map((a) => a.id);
  if (ids.length === 0) return { scored: 0, lowConfidence: 0 };

  const signalsMap = await collectArtistSignals(ids);

  const enabled = SCORING_WEIGHTS.artist.filter((w) => w.enabled);
  const weightSum = enabled.reduce((s, w) => s + w.weight, 0) || 1;
  const minPop = SCORING_WEIGHTS.normalization.minPopulationForPercentile;

  // 신호 키별 모집단 배열
  const populations = new Map<string, number[]>();
  for (const w of enabled) {
    populations.set(
      w.key,
      ids.map((id) => signalsMap.get(id)?.[w.key] ?? 0),
    );
  }

  const computedAt = new Date().toISOString();
  let lowConfidenceCount = 0;

  const updates = ids.map((id) => {
    const sig = signalsMap.get(id) ?? {};
    const entries: ScoreSignalEntry[] = [];
    let lowConf = false;
    let final = 0;

    for (const w of enabled) {
      const raw = sig[w.key] ?? 0;
      const bounded = w.key === "review_avg" ? { min: 0, max: 5 } : undefined;
      const norm = normalizeSignal(raw, populations.get(w.key)!, {
        bounded,
        minPopulation: minPop,
      });
      const weight = w.weight / weightSum;
      const contribution = norm.normalized * weight;
      final += contribution;
      if (norm.lowConfidence) lowConf = true;
      entries.push({
        key: w.key,
        label: w.label,
        raw: round2(raw),
        normalized: round2(norm.normalized),
        method: norm.method,
        weight: round2(weight),
        contribution: round2(contribution),
        reason: reasonFor(w.label, raw, norm),
      });
    }

    if (lowConf) lowConfidenceCount++;

    const breakdown: ScoreBreakdown = {
      version: 1,
      computedAt,
      finalScore: round2(final),
      lowConfidence: lowConf,
      signals: entries,
      notes: [],
    };

    return {
      id,
      popularity_score: round2(final),
      score_breakdown: breakdown,
      score_updated_at: computedAt,
    };
  });

  await applyScores(db, "apply_artist_scores", updates);

  return { scored: updates.length, lowConfidence: lowConfidenceCount };
}
