import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { ScoreBreakdown, ScoreNote, ScoreSignalEntry } from "@/types/scoring";
import { CONCERT_PRENORMALIZED, SCORING_WEIGHTS } from "./config";
import { normalizeSignal } from "./normalize";
import { applyScores, fetchAll, formatNum, round2 } from "./util";

export interface ConcertScoreResult {
  scored: number;
  lowConfidence: number;
}

interface EventRow {
  id: string;
  title: string;
  start_date: string;
  status: string;
  has_timetable: boolean | null;
}
interface EventArtistRow {
  event_id: string;
  artist_id: string;
}
interface EventAggRow {
  event_id: string;
  interested_count: number | null;
  booking_count: number | null;
  review_count: number | null;
  artist_count: number | null;
}

/** 임박도 0~100 — ended는 0, 임박할수록 높음 */
function freshnessScore(status: string, startDate: string): number {
  if (status === "ended") return 0;
  const days = (new Date(startDate).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return 70; // 진행 중/시작 직후
  if (days <= 14) return 100;
  if (days <= 30) return 80;
  if (days <= 60) return 60;
  if (days <= 120) return 40;
  return 20;
}

export async function computeConcertPopularityScores(): Promise<ConcertScoreResult> {
  const db = createServiceRoleClient();

  const [events, eventArtists, artistScores, aggRows] = await Promise.all([
    fetchAll<EventRow>((f, t) =>
      db.from("events").select("id,title,start_date,status,has_timetable").range(f, t),
    ),
    fetchAll<EventArtistRow>((f, t) =>
      db.from("event_artists").select("event_id,artist_id").range(f, t),
    ),
    fetchAll<{ id: string; popularity_score: number | null }>((f, t) =>
      db.from("artists").select("id,popularity_score").range(f, t),
    ),
    fetchAll<EventAggRow>((f, t) =>
      db
        .from("event_engagement_agg")
        .select("event_id,interested_count,booking_count,review_count,artist_count")
        .range(f, t),
    ),
  ]);

  if (events.length === 0) return { scored: 0, lowConfidence: 0 };

  const artistScoreById = new Map(artistScores.map((a) => [a.id, a.popularity_score ?? 0]));
  const aggById = new Map(aggRows.map((r) => [r.event_id, r]));

  // event_id → 참여 아티스트 점수 배열 (deprecated events.artist_id 미사용)
  const eventArtistScores = new Map<string, number[]>();
  for (const ea of eventArtists) {
    const arr = eventArtistScores.get(ea.event_id) ?? [];
    arr.push(artistScoreById.get(ea.artist_id) ?? 0);
    eventArtistScores.set(ea.event_id, arr);
  }

  // 1) 이벤트별 원시 신호 계산
  const raw = new Map<string, Record<string, number>>();
  for (const ev of events) {
    const scores = eventArtistScores.get(ev.id) ?? [];
    const avg = scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : 0;
    const max = scores.length ? Math.max(...scores) : 0;
    const agg = aggById.get(ev.id);
    const interested = agg?.interested_count ?? 0;
    const booking = agg?.booking_count ?? 0;
    const review = agg?.review_count ?? 0;
    const artistCount = agg?.artist_count ?? scores.length;

    raw.set(ev.id, {
      artist_influence: round2(0.7 * avg + 0.3 * max),
      ticket_demand: interested + 2 * booking + review,
      event_scale: artistCount + (ev.has_timetable ? 3 : 0),
      community_attention: interested + review,
      freshness: freshnessScore(ev.status, ev.start_date),
    });
  }

  const enabled = SCORING_WEIGHTS.concert.filter((w) => w.enabled);
  const weightSum = enabled.reduce((s, w) => s + w.weight, 0) || 1;
  const minPop = SCORING_WEIGHTS.normalization.minPopulationForPercentile;

  // 2) 정규화 필요한 키만 모집단 구성
  const populations = new Map<string, number[]>();
  for (const w of enabled) {
    if (CONCERT_PRENORMALIZED.has(w.key)) continue;
    populations.set(
      w.key,
      events.map((ev) => raw.get(ev.id)![w.key]),
    );
  }

  const computedAt = new Date().toISOString();
  let lowConfidenceCount = 0;

  const updates = events.map((ev) => {
    const r = raw.get(ev.id)!;
    const entries: ScoreSignalEntry[] = [];
    const notes: ScoreNote[] = [];
    let lowConf = false;
    let final = 0;

    for (const w of enabled) {
      const rawVal = r[w.key];
      let normalized: number;
      let method: ScoreSignalEntry["method"];
      if (CONCERT_PRENORMALIZED.has(w.key)) {
        normalized = Math.max(0, Math.min(100, rawVal));
        method = "min_max";
      } else {
        const norm = normalizeSignal(rawVal, populations.get(w.key)!, { minPopulation: minPop });
        normalized = norm.normalized;
        method = norm.method;
        if (norm.lowConfidence) lowConf = true;
      }
      const weight = w.weight / weightSum;
      const contribution = normalized * weight;
      final += contribution;
      entries.push({
        key: w.key,
        label: w.label,
        raw: round2(rawVal),
        normalized: round2(normalized),
        method,
        weight: round2(weight),
        contribution: round2(contribution),
        reason:
          w.key === "freshness"
            ? `${w.label} ${Math.round(normalized)}/100`
            : `${w.label} ${formatNum(rawVal)}`,
      });
    }

    if (lowConf) lowConfidenceCount++;
    notes.push({ key: "event_scale", note: "공연장 수용인원 데이터 없음 — 규모 추정에서 제외" });

    const breakdown: ScoreBreakdown = {
      version: 1,
      computedAt,
      finalScore: round2(final),
      lowConfidence: lowConf,
      signals: entries,
      notes,
    };

    return {
      id: ev.id,
      popularity_score: round2(final),
      score_breakdown: breakdown,
      score_updated_at: computedAt,
    };
  });

  await applyScores(db, "apply_event_scores", updates);

  return { scored: updates.length, lowConfidence: lowConfidenceCount };
}
