# lib/crawler/ — 크롤러 잡 관리

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `job-manager.ts` | 크롤러 잡 생성/완료 — `createCrawlerJob()`, `finishCrawlerJob()`, `updateCrawlerJob()` |
| `structure-check.ts` | 스크래퍼 구조 변경 감지 — `checkStructureChange()` |
| `error-logger.ts` | 인제스천 에러 로깅 |

## crawler_jobs 테이블

status: pending → running → success/partial/failed
meta 필드에 각 단계별 통계 (artistAudit, autoFix, autoDelete, enrichQueue, statusSweep, merge) 저장.

## 크론 엔트리포인트

`app/api/admin/crawler/cron/route.ts` — Vercel Cron + 로컬 launchd 지원
