# lib/ingestion/ — 크롤 데이터 → DB 저장 파이프라인

## 흐름

```
RawScrapedEvent → normalize.ts → schemas.ts(검증) → upsert.ts → DB
                                                  → artist-matcher.ts (아티스트/공연장 생성)
```

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `normalize.ts` | 제목·날짜·공연장명 정규화, `normalizeEvent()`, `inferStatus()` |
| `schemas.ts` | Zod 유효성 스키마 — EventIngestionSchema, ArtistIngestionSchema, VenueIngestionSchema |
| `upsert.ts` | 이벤트 UPSERT, dedup_key 기반 중복 처리 |
| `artist-matcher.ts` | 아티스트·공연장 매칭/생성. `matchOrCreateArtists()`(자동 생성), `matchExistingArtist()`(연결만, 타임테이블용), `matchOrCreateVenue()` |
| `timetable-unmatched.ts` | 타임테이블 임포트 시 기존 리스트에 없는 아티스트 로그 → `timetable_unmatched_artists` |
| `event-enrich.ts` | Gemini 직접 보강. `enrichEventArtists()` — 페스티벌은 `collectFestivalLineup()`(source_urls 재fetch + Google 그라운딩)로 라인업 전체 수집 후 `event_artists` 에 lineup 연결 |
| `artist-audit.ts` | 크롤 후 아티스트 미연결 이벤트 감지 → AI 큐 등록 |
| `artist-backfill.ts` | 기존 이벤트의 아티스트 재연결 배치 처리 |
| `dedup.ts` | dedup_key 생성 — SHA256(title|venue|date).slice(0,32) |

## 입력 타입

- `RawScrapedEvent` — 스크래퍼 원시 출력 (`types/ingestion.ts`)
- `NormalizedEvent` — normalize 후 타입 (`types/ingestion.ts`)

## 검증 실패 시

`ingestion_errors` 테이블에 `step='validate'`로 기록.
