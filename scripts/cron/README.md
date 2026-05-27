# Articket 로컬 Cron

Vercel Pro 없이 **macOS launchd**로 크롤러를 자동 실행하는 구성입니다.

## 구조

```
scripts/cron/
  install.sh      설치 (최초 1회)
  uninstall.sh    제거
  trigger.sh      실제 실행 스크립트 (launchd가 호출)
  .cron.env       시크릿 (gitignore됨, install.sh가 생성)
```

## 동작 방식

```
macOS launchd
  └─ 매시간 정각 → trigger.sh
       └─ curl → https://your-app.vercel.app/api/admin/crawler/cron
                    └─ StagePick 크롤링 → Supabase DB 저장
```

Vercel 유료 cron과 **완전히 동일한 엔드포인트**를 호출합니다.  
Mac이 절전 상태였다면 깨어날 때 즉시 실행됩니다.

## 설치

```bash
bash scripts/cron/install.sh
```

설치 중 아래 두 가지를 입력합니다:
- **Vercel URL**: `https://articket-admin.vercel.app` (배포된 URL)
- **CRON_SECRET**: Vercel 환경변수에 설정한 값 (없으면 엔터)

## 테스트

```bash
bash scripts/cron/trigger.sh
```

## 로그 확인

```bash
tail -f ~/Library/Logs/articket-cron.log
```

## 제거

```bash
bash scripts/cron/uninstall.sh
```

## Vercel 환경변수 CRON_SECRET 설정 (권장)

엔드포인트를 외부에서 아무나 호출하지 못하도록 시크릿을 설정합니다.

1. Vercel 대시보드 → Project Settings → Environment Variables
2. `CRON_SECRET` = 임의의 긴 문자열 추가
3. Redeploy
4. `install.sh` 실행 시 같은 값 입력

> **참고**: `vercel.json`의 `crons` 항목은 Pro 플랜 전용이라 현재 비활성 상태입니다.  
> Pro로 업그레이드하면 `install.sh`로 설치한 로컬 cron 대신 Vercel cron이 자동 작동합니다.
