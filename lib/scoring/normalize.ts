import type { NormalizeMethod } from "@/types/scoring";

export function logCompress(v: number): number {
  return Math.log1p(Math.max(0, v));
}

export function minMax(v: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
}

/**
 * 모집단(오름차순) 대비 백분위 0~100 — value보다 **엄격히 작은** 비율.
 * 0이 다수인 신호에서 0이 100위로 부풀지 않게(=무신호는 하위) strictly-less 사용.
 */
export function percentileRank(v: number, sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return (lo / n) * 100;
}

export interface NormalizeResult {
  normalized: number;
  method: NormalizeMethod;
  lowConfidence: boolean;
}

/**
 * 신호 1개 정규화 → 0~100.
 * - bounded(별점 등): min-max 직접
 * - heavy-tail 카운트: log1p 압축 후, 모집단 충분하면 percentile, 작으면 log-min-max(lowConfidence)
 */
export function normalizeSignal(
  value: number,
  population: number[],
  opts?: { bounded?: { min: number; max: number }; minPopulation?: number },
): NormalizeResult {
  if (opts?.bounded) {
    return {
      normalized: minMax(value, opts.bounded.min, opts.bounded.max),
      method: "min_max",
      lowConfidence: false,
    };
  }
  if (population.length === 0) {
    return { normalized: 0, method: "log_min_max", lowConfidence: true };
  }

  const minPop = opts?.minPopulation ?? 20;
  const logged = population.map(logCompress);
  const lv = logCompress(value);

  if (population.length >= minPop) {
    const sorted = [...logged].sort((a, b) => a - b);
    return {
      normalized: percentileRank(lv, sorted),
      method: "percentile",
      lowConfidence: false,
    };
  }

  const min = Math.min(...logged, lv);
  const max = Math.max(...logged, lv);
  return {
    normalized: minMax(lv, min, max),
    method: "log_min_max",
    lowConfidence: true,
  };
}
