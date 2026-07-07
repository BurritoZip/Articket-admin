# supabase/migrations/ — 마이그레이션 연대기

## 규칙

- 새 마이그레이션: `YYYYMMDDHHMMSS_설명.sql` 파일 추가
- 적용: `supabase db push`
- **이 레포가 source of truth** — Supabase 대시보드 직접 수정 금지

## 주요 마이그레이션

| 파일 | 추가된 것 |
|---|---|
| `20260501000000_init.sql` | 기본 스키마 (events, artists, venues, users) |
| `20260522000000_ingestion_system.sql` | 크롤러 잡, ai_processing_queue, ingestion_errors |
| `20260522010000_add_event_artists.sql` | event_artists 조인 테이블 |
| `20260523000001_add_event_venues.sql` | event_venues 조인 테이블 |
| `20260527200000_add_artist_fields.sql` | 아티스트 보강 필드 (name_en, enrichment_status, label, country, sns_links) |
| `20260528000000_artist_dedup_enrich.sql` | 아티스트 dedup 인덱스, artist_merge_logs |
| `20260528200000_data_quality_fix_logs.sql` | 데이터 품질 수정 이력 테이블 |
| `20260528400000_pipeline_step_status.sql` | 파이프라인 단계별 실시간 상태 |
| `20260529000000_fix_logs_add_reasoning.sql` | fix_logs에 gemini_reasoning, error_msg 추가 |
| `20260707130000_event_booking_link_issues.sql` | iOS 예매 링크 미연결 이슈 로그 (anon insert) |
| `20260707140000_app_error_logs.sql` | iOS 앱 런타임 에러/크래시 로그 (anon insert) — Admin `/admin/error-logs` 조회 |
| `20260707150000_timetable_unmatched_artists.sql` | 타임테이블 임포트 미매칭 아티스트 로그 (서버 전용) — Admin `/admin/timetable-unmatched` 조회 |
| `20260707160000_event_lineup_tracking.sql` | events 에 `lineup_checked_at`, `lineup_count` — 페스티벌 라인업 수집 추적 |
