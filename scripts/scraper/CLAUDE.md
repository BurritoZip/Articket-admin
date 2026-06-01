# scripts/scraper/ — Python 스크래퍼

## 실행 방식

```bash
cd scripts/scraper
python main.py              # yes24/melon/interpark/yanolja/festivallife (보조 사이트)
python main.py --site yes24 # 특정 사이트만
python main.py --dry-run    # DB 저장 없이 파싱 결과만
```

**StagePick은 제외** — TypeScript Vercel 크론 전담 (현재 비활성).

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `main.py` | 진입점 — 사이트별 스크래퍼 실행 + DB 저장 |
| `database.py` | Supabase UPSERT 헬퍼 — `upsert_event/artist/venue()` (검증 포함) |
| `validation.py` | 입력 유효성 검증 — `validate_event/artist/venue()` |
| `config.py` | 사이트별 설정 |
| `scrapers/` | 사이트별 스크래퍼 (yes24, melon, interpark, yanolja, festivallife, naver) |
| `utils/normalizer.py` | 공연장명·주소 정제, 날짜 파싱, 전시 필터 |

## 자동 실행

`scripts/cron/trigger-python.sh` — 로컬 launchd 오전6시/오후6시 실행.
환경변수: `scripts/cron/.cron-python.env` (gitignore됨).
