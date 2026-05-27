export type CrawlerJobStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "partial";
export type IngestionStep =
  | "crawl"
  | "parse"
  | "normalize"
  | "match"
  | "upsert"
  | "ai"
  | "structure_change";
export type AITaskType =
  | "normalize_venue"
  | "deduplicate_artist"
  | "ocr_timetable"
  | "parse_dates"
  | "classify_genre"
  | "summarize_event"
  | "detect_duplicates"
  | "match_artist"
  | "clean_data";
export type AITaskStatus =
  | "pending"
  | "processing"
  | "done"
  | "failed"
  | "skipped";
export type OCRStatus =
  | "pending"
  | "processing"
  | "done"
  | "failed"
  | "skipped";

export interface CrawlerSourceSelectors {
  item?: string; // 목록 아이템 선택자
  title?: string; // 공연명 선택자
  venue?: string; // 공연장 선택자
  date?: string; // 날짜 선택자
  link?: string; // 상세 링크 선택자
  image?: string; // 이미지 선택자
}

export interface CrawlerSourceConfig {
  rateLimit?: number; // 요청 간격 (ms)
  listPath?: string; // 목록 페이지 경로
  selectors?: CrawlerSourceSelectors;
  consecutiveZeroCount?: number; // 연속 0건 카운터 (구조 변경 감지)
  lastSuccessCount?: number; // 마지막 성공 시 수집 건수
  lastStructureChangeAt?: string; // 마지막 구조 변경 감지 시각
}

export interface CrawlerSource {
  id: string;
  name: string;
  display_name: string;
  base_url: string;
  enabled: boolean;
  config: CrawlerSourceConfig;
  created_at: string;
}

export interface CrawlerJob {
  id: string;
  source_name: string;
  status: CrawlerJobStatus;
  started_at: string | null;
  finished_at: string | null;
  pages_crawled: number;
  events_found: number;
  events_upserted: number;
  events_skipped: number;
  error_count: number;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface RawEventPayload {
  id: string;
  job_id: string | null;
  source_name: string;
  source_url: string;
  raw_html: string | null;
  parsed_json: Record<string, unknown> | null;
  crawled_at: string;
  dedup_key: string | null;
  processed: boolean;
  event_id: string | null;
}

export interface EventChangeLog {
  id: string;
  event_id: string;
  job_id: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export interface IngestionError {
  id: string;
  job_id: string | null;
  source_name: string;
  source_url: string | null;
  step: IngestionStep;
  error_type: string | null;
  error_message: string | null;
  stack_trace: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
}

export interface AIQueueItem {
  id: string;
  task_type: AITaskType;
  status: AITaskStatus;
  priority: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  processed_at: string | null;
  entity_type: string | null;
  entity_id: string | null;
}

export interface AutomationRun {
  id: string;
  run_type: string;
  status: "running" | "success" | "failed";
  started_at: string;
  finished_at: string | null;
  items_processed: number;
  items_changed: number;
  summary: Record<string, unknown>;
  triggered_by: string;
}

export interface EventMergeCandidate {
  id: string;
  event_id_a: string;
  event_id_b: string;
  similarity: number | null;
  reason: string | null;
  status: "pending" | "merged" | "rejected" | "reviewed";
  reviewed_by: string | null;
  created_at: string;
}

export interface EventTimetableAsset {
  id: string;
  event_id: string;
  asset_url: string;
  asset_type: "image" | "pdf" | "html";
  ocr_status: OCRStatus;
  ocr_raw_text: string | null;
  ocr_parsed: Record<string, unknown> | null;
  created_at: string;
}
