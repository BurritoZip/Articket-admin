import type { RawScrapedEvent } from "@/types/ingestion";
import type { IngestionPipelineResult } from "@/types/ingestion";

export interface ScraperAdapter {
  readonly sourceName: string;
  readonly displayName: string;
  readonly baseUrl: string;

  /** 목록 페이지에서 이벤트 상세 URL 수집 */
  scrapeList(options?: ScrapeOptions): Promise<string[]>;

  /** 상세 페이지 1개 파싱 */
  scrapeDetail(url: string): Promise<RawScrapedEvent | null>;

  /** 전체 파이프라인 실행 */
  run(options?: ScrapeOptions): Promise<IngestionPipelineResult>;
}

export interface ScrapeOptions {
  maxPages?: number;
  maxItems?: number;
  dryRun?: boolean;
  jobId?: string;
}
