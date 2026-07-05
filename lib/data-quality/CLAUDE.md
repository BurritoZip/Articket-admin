# lib/data-quality/ — 데이터 품질 자동 수정·삭제

## 흐름

```
DB 스캔 → 이상 감지 → auto-fix (필드 null) 또는 auto-delete (행 삭제)
                    → Gemini 분석 필요 시 → AI 판단 후 처리
```

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `patterns.ts` | 공유 정규식 — PRICE_RE, TICKET_GRADE_RE, DATE_RE, URL_RE, VENUE_LIKE_RE |
| `auto-fix.ts` | 이상 필드 null 처리 + AI 큐 등록 — `runDataQualityAutoFix(opts)` |
| `auto-delete.ts` | 쓰레기 행 삭제 + Gemini 판단 — `runDataQualityAutoDelete(opts)` |
| `purge-non-concerts.ts` | 비콘서트(전시/뮤지컬 등) 최근 크롤분 하드삭제 — `autoPurgeNonConcerts()` |
| `purge-non-music.ts` | 비음악 아티스트 연결 이벤트 정리 — `purgeNonMusicArtistEvents()` |
| `purge-unlinked.ts` | 아티스트 연결 실패 이벤트 하드삭제 — `purgeUnlinkedEvents()` |
| `purge-old-events.ts` | 종료 `PURGE_ENDED_AFTER_DAYS`(180일) 지난 공연 **소프트 숨김**(`is_hidden`, 삭제 아님) — `purgeOldEvents()` (파이프라인 `purge` 단계) |

## Gemini 사용

`auto-delete.ts`에서 `geminiDeleteDecision()` 호출:
- 판단 이유를 `data_quality_fix_logs.gemini_reasoning`에 저장
- 실패 시 `error_msg` 기록 (무시 안 함)

## 로그 테이블

`data_quality_fix_logs`: entity_type, field_name, old_value, fix_method, gemini_reasoning, error_msg
