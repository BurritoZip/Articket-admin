export type SnsLinks = {
  spotify?: string;
  apple_music?: string;
  youtube?: string;
  instagram?: string;
  twitter?: string;
};

export type EnrichmentStatus =
  | "pending"
  | "in_progress"
  | "enriched"
  | "failed"
  | "skipped";

export type EnrichmentSources = {
  namu?: { at: string; ok: boolean };
  melon?: { at: string; ok: boolean };
  naver?: { at: string; ok: boolean };
  wikipedia?: { at: string; ok: boolean };
};

export type ArtistRow = {
  id: string;
  name: string;
  /** 영문 이름 (예: IU, BTS) */
  name_en: string | null;
  avatar_url: string | null;
  followers_count: number;
  upcoming_event_count: number;
  occupation: string | null;
  birth_date: string | null;
  birth_place: string | null;
  related: string | null;
  /** 소속사 / 레이블 */
  label: string | null;
  /** 국가 코드 (예: KR, US) */
  country: string | null;
  /** SNS 링크 */
  sns_links: SnsLinks | null;
  /** 외부 소스 보강 상태 */
  enrichment_status: EnrichmentStatus | null;
  /** 마지막 보강 시도 시각 */
  enrichment_attempted_at: string | null;
  /** 소스별 보강 결과 기록 */
  enrichment_sources: EnrichmentSources | null;
  /** event_artists 테이블 기준 연결된 공연 수 (서버에서 계산) */
  linked_event_count?: number;
};

export type AlbumRow = {
  id: string;
  artist_id: string;
  title: string;
  cover_url: string | null;
  released_year: string | null;
};

export type MusicVideoRow = {
  id: string;
  artist_id: string;
  title: string;
  thumbnail_url: string | null;
  view_count: string | null;
  like_count: string | null;
  uploaded_at: string | null;
};
