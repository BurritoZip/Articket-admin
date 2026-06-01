# app/api/admin/ — 관리자 API 라우트 지도

## 데이터 CRUD

| 경로 | 역할 |
|---|---|
| `events/` | 공연 목록/상세/생성/수정, `sweep-statuses/` (상태 일괄 업데이트) |
| `artists/` | 아티스트 CRUD, `dedup/`, `merge/`, `auto-merge/`, `enrich/`, `stats/` |
| `venues/` | 공연장 CRUD, `dedup/`, `merge/`, `auto-merge/` |
| `timetable/` | 타임테이블 CRUD |
| `bookings/` | 예매 관리 |
| `users/` | 유저 관리 |
| `reviews/` | 리뷰 관리 |

## 파이프라인/자동화

| 경로 | 역할 |
|---|---|
| `crawler/cron/` | Vercel Cron 엔트리포인트 — 전체 파이프라인 실행 |
| `crawler/run/` | 수동 크롤러 실행 |
| `pipeline/run/` | 수동 전체 파이프라인 트리거 |
| `pipeline/status/` | 파이프라인 단계별 실시간 상태 GET |
| `ingestion/queue/` | AI 처리 큐 관리 |
| `ingestion/queue/drain/` | AI 큐 전체 드레인 (루프 처리) |
| `ingestion/artist-backfill/` | 아티스트 재연결 배치 |

## 데이터 품질

| 경로 | 역할 |
|---|---|
| `data-quality/` | 품질 스캔 GET |
| `data-quality/auto-fix/` | 이상 필드 자동 수정 POST |
| `data-quality/auto-delete/` | 불량 데이터 삭제 POST |
| `data-quality/logs/` | 수정·삭제 이력 조회 GET |

## 공통 패턴

모든 라우트: `requireAdmin()` → 실패 시 즉시 return.
뮤테이션: `withErrorHandler()` 래퍼 사용.
