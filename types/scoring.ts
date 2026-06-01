// 인기/트렌드 스코어링 타입

export type NormalizeMethod = "percentile" | "log_min_max" | "min_max";

/** score_breakdown.signals[] 항목 — 설명가능(why) 단위 */
export interface ScoreSignalEntry {
  key: string;
  label: string;
  /** 원시 신호 값 */
  raw: number;
  /** 0~100 정규화 값 */
  normalized: number;
  method: NormalizeMethod;
  /** enabled 신호 합=1로 재정규화된 가중치 */
  weight: number;
  /** normalized * weight */
  contribution: number;
  /** 사람이 읽는 설명 문자열 */
  reason: string;
}

export interface ScoreNote {
  key: string;
  note: string;
}

/** artists/events.score_breakdown JSONB 형태 (공통) */
export interface ScoreBreakdown {
  version: number;
  computedAt: string;
  finalScore: number;
  lowConfidence: boolean;
  signals: ScoreSignalEntry[];
  notes: ScoreNote[];
}

/** 가중치 설정 단위 — lib/scoring/config.ts SCORING_WEIGHTS */
export interface SignalWeight {
  key: string;
  weight: number;
  label: string;
  /** 예약 슬롯(외부 신호)은 false로 출고 → 켜면 가중치 자동 재정규화 */
  enabled: boolean;
}

export interface ScoringConfig {
  artist: SignalWeight[];
  concert: SignalWeight[];
  trending: {
    currentWindowDays: number;
    baselineWindowDays: number;
    minSnapshotsForTrend: number;
  };
  normalization: {
    minPopulationForPercentile: number;
  };
}
