# lib/ — 서버 사이드 비즈니스 로직

## 모듈 지도

| 디렉토리/파일 | 역할 |
|---|---|
| `ingestion/` | 크롤 데이터 → DB 저장 파이프라인 (normalize → validate → upsert) |
| `data-quality/` | 이상 데이터 자동 수정·삭제 (auto-fix, auto-delete, Gemini 활용) |
| `artists/` | 아티스트 중복탐지·병합·보강 (dedup, merge, enrich) |
| `venues/` | 공연장 병합 로직 |
| `db/` | DB 공통 유틸 — pipeline-tracker, status-sweeper |
| `crawler/` | 크롤러 잡 생성·완료 관리 |
| `scrapers/` | 사이트별 TypeScript 스크래퍼 (현재 stagepick) |
| `supabase/` | Supabase 클라이언트 (server/client/service-role) |
| `gemini.ts` | Gemini API 공용 클라이언트 — `geminiText(prompt)` |
| `completeness.ts` | 아티스트/공연 데이터 완성도 계산 |
| `format-kst.ts` | KST 날짜 포맷 유틸 |
| `api-handler.ts` | API 라우트 공통 에러 핸들러 `withErrorHandler()` |
| `admin-pagination.ts` | 관리자 목록 페이지네이션 파싱 |

## 주요 패턴

- 뮤테이션: `createServiceRoleClient()` (RLS 우회)
- 읽기: `createClient()` (서버 클라이언트)
- 모든 API 라우트: `requireAdmin()` 먼저 호출
