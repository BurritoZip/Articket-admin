#!/bin/bash
# Articket 크롤러 트리거 — Vercel cron 대체용
# launchd 또는 수동으로 실행

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.cron.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[Articket Cron] ERROR: .cron.env 파일이 없습니다. install.sh를 먼저 실행하세요." >&2
  exit 1
fi

# shellcheck source=.cron.env
source "$ENV_FILE"

if [[ -z "${VERCEL_URL:-}" ]]; then
  echo "[Articket Cron] ERROR: VERCEL_URL이 설정되지 않았습니다." >&2
  exit 1
fi

LOG_FILE="${LOG_FILE:-$HOME/Library/Logs/articket-cron.log}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$TIMESTAMP] 🚀 크롤링 시작 ($VERCEL_URL)" | tee -a "$LOG_FILE"

# CRON_SECRET이 있으면 Authorization 헤더 추가
AUTH_HEADER=""
if [[ -n "${CRON_SECRET:-}" ]]; then
  AUTH_HEADER="-H Authorization: Bearer $CRON_SECRET"
fi

# curl로 cron 엔드포인트 호출 (타임아웃 5분)
HTTP_RESPONSE=$(curl -s \
  --max-time 300 \
  --write-out "\n__STATUS__%{http_code}" \
  -X GET \
  ${CRON_SECRET:+-H "Authorization: Bearer $CRON_SECRET"} \
  "$VERCEL_URL/api/admin/crawler/cron" 2>&1) || CURL_EXIT=$?

if [[ -n "${CURL_EXIT:-}" ]]; then
  echo "[$TIMESTAMP] ❌ curl 실패 (exit $CURL_EXIT)" | tee -a "$LOG_FILE"
  exit 1
fi

HTTP_CODE=$(echo "$HTTP_RESPONSE" | grep '__STATUS__' | sed 's/__STATUS__//')
BODY=$(echo "$HTTP_RESPONSE" | grep -v '__STATUS__')

echo "[$TIMESTAMP] HTTP $HTTP_CODE | $BODY" | tee -a "$LOG_FILE"

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "[$TIMESTAMP] ✅ 크롤링 완료" | tee -a "$LOG_FILE"
else
  echo "[$TIMESTAMP] ❌ 크롤링 실패 (HTTP $HTTP_CODE)" | tee -a "$LOG_FILE"
  exit 1
fi
