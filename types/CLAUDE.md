# types/ — TypeScript 타입 정의

## 파일별 역할

| 파일 | 역할 |
|---|---|
| `event.ts` | EventStatus, EventRow, EventArtistRow, EventVenueRow |
| `artist.ts` | ArtistRow, SnsLinks, EnrichmentStatus |
| `venue.ts` | VenueRow |
| `ingestion.ts` | RawScrapedEvent, NormalizedEvent, UpsertResult, IngestionPipelineResult |
| `crawler.ts` | CrawlerJob, CrawlerSource, AiTaskType (9가지 AI 태스크 타입) |
| `timetable.ts` | TimetablePerformanceRow |
| `admin-user.ts` | AdminUser 타입 |
| `database.ts` | 전체 DB 스키마 타입 (자동생성) |
