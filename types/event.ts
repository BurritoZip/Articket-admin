import type { ScoreBreakdown } from "./scoring";

export type EventStatus = "upcoming" | "on_sale" | "ongoing" | "ended";

export type EventRow = {
  id: string;
  title: string;
  normalized_title: string | null;
  dedup_key: string | null;
  artist_id: string;
  venue_id: string;
  poster_url: string | null;
  start_date: string;
  end_date: string | null;
  status: EventStatus;
  genre: string | null;
  duration: string | null;
  age_restriction: string | null;
  ticket_open_date: string | null;
  ticket_close_date: string | null;
  ticket_provider: string | null;
  booking_url: string | null;
  organizer: string | null;
  notice_text: string | null;
  is_banner: boolean;
  has_timetable: boolean;
  /** 인기도 점수 0~100 (스코어링 엔진 산출) */
  popularity_score: number | null;
  /** 트렌드 점수 — 최근7일/이전30일 비율 ×100 */
  trending_score: number | null;
  /** 점수 산출 근거 (설명가능) */
  score_breakdown: ScoreBreakdown | null;
  score_updated_at: string | null;
  /** 아티스트 연결 상태 (보강 파이프라인 내부용) — null=미시도 */
  artist_link_status: "linked" | "multi_artist" | "no_artist" | null;
  /** 아티스트 보강 시도 시각 — 재선택 방지 워터마크 */
  enrich_attempted_at: string | null;
  /** 설명 그라운딩 보강 시도 시각 — 재호출 방지 워터마크 */
  description_checked_at: string | null;
  /** 페스티벌 라인업 마지막 수집 시각 */
  lineup_checked_at: string | null;
  /** 수집된 라인업 아티스트 수 (multi_artist 공연) */
  lineup_count: number;
  /** 소프트 숨김 — true 면 앱/목록에서 제외(하드삭제 아님, 이력 보존) */
  is_hidden: boolean;
  /** 숨김 처리 시각 */
  hidden_at: string | null;
  /** 숨김 사유 (예: "ended_180d", "merged_into:{id}", "unlinked_no_artist") */
  hidden_reason: string | null;
  /**
   * 자동 병합으로 흡수된 경우 canonical 이벤트 id. NOT NULL 이면 is_hidden=true.
   * 하드삭제 대신 이 포인터로 남겨 유저 데이터(FK)와 복구 가능성을 지킨다.
   */
  merged_into_event_id: string | null;
  /** 운영자가 수동 수정해 크롤 덮어쓰기에서 보호할 필드명 목록 (upsert 가 스킵) */
  locked_fields: string[];
};

export type EventArtistRow = {
  id: string;
  event_id: string;
  artist_id: string;
  artist_name: string;
  role: string;
  display_order: number;
  source_name: string | null;
  created_at: string;
  updated_at: string;
};

export type EventVenueRow = {
  id: string;
  event_id: string;
  venue_id: string;
  display_order: number;
  created_at: string;
};

export type OptionItem = {
  id: string;
  name: string;
};
