# Articket 공연 크롤러

공연 티켓 사이트에서 이벤트·아티스트·공연장 데이터를 수집해 Supabase DB에 저장하는 Python 스크립트.

## 지원 사이트

| 사이트 | 파일 | 역할 |
|--------|------|------|
| StagePick | `scrapers/stagepick.py` | **주 소스** — 공연장/아티스트 상세 포함 |
| YES24 | `scrapers/yes24.py` | 보조 (source_url 보완) |
| 야놀자 | `scrapers/yanolja.py` | 보조 |
| FestivalLife | `scrapers/festivallife.py` | 보조 |
| 인터파크 | `scrapers/interpark.py` | 보조 |
| 멜론티켓 | `scrapers/melon.py` | 보조 |

## 설치

```bash
cd scripts/scraper
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 환경 변수 설정

```bash
cp .env.example .env
# .env 파일에 Supabase URL과 service_role 키 입력
```

## 실행

```bash
# 모든 사이트 크롤링
python main.py

# 특정 사이트만
python main.py --site stagepick
python main.py --site yes24

# DB 저장 없이 파싱 결과만 확인
python main.py --dry-run
python main.py --dry-run --site festivallife
```

## 유틸리티 스크립트

| 스크립트 | 용도 |
|----------|------|
| `count.py` | DB 현재 데이터 수 확인 |
| `check_dupes.py` | 중복 이벤트 탐지 |
| `dedupe_events.py` | 중복 이벤트 정리 |
| `cleanup_db.py` | 오염 데이터 일괄 삭제 |
| `cleanup_venue_and_dupes.py` | venue NULL 이벤트·완전 중복 삭제 |
| `link_artists.py` | 이벤트 제목 기반 artist_id 연결 |
| `enrich_artists.py` | Wikipedia에서 아티스트 프로필 보강 |
| `classify_events.py` | Claude AI로 비공연 이벤트 분류·삭제 |
| `inspect_venues.py` | venue 상태 검토 |

## 구조

```
scripts/scraper/
  main.py           # 진입점
  config.py         # 사이트별 URL/설정
  database.py       # Supabase UPSERT 헬퍼
  scrapers/         # 사이트별 스크래퍼
  utils/
    dedup.py        # dedup_key 생성 (SHA256)
    image.py        # 포스터 이미지 다운로드·Storage 업로드
    normalizer.py   # 텍스트 정규화·날짜 파싱
```
