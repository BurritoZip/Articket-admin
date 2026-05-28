#!/bin/bash
# Articket Python 스크래퍼 트리거 — 보조 사이트 전체 실행
# launchd 또는 수동으로 실행

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRAPER_DIR="$(cd "$SCRIPT_DIR/../scraper" && pwd)"

ENV_FILE="$SCRIPT_DIR/.cron-python.env"
LOG_FILE="${LOG_FILE:-$HOME/Library/Logs/articket-python-cron.log}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[$TIMESTAMP] ERROR: .cron-python.env 없음. install-python.sh 먼저 실행." >&2
  exit 1
fi

source "$ENV_FILE"

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_KEY:-}" ]]; then
  echo "[$TIMESTAMP] ERROR: SUPABASE_URL 또는 SUPABASE_SERVICE_KEY 미설정" >&2
  exit 1
fi

echo "[$TIMESTAMP] Python 스크래퍼 시작 (전체 사이트)" | tee -a "$LOG_FILE"

export SUPABASE_URL
export SUPABASE_SERVICE_KEY

cd "$SCRAPER_DIR"

PYTHON_BIN="${PYTHON_BIN:-/opt/homebrew/bin/python3}"

"$PYTHON_BIN" main.py 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "[$TIMESTAMP] Python 스크래퍼 완료" | tee -a "$LOG_FILE"
else
  echo "[$TIMESTAMP] Python 스크래퍼 실패 (exit $EXIT_CODE)" | tee -a "$LOG_FILE"
  exit $EXIT_CODE
fi

# ── AI 큐 드레인 (큐가 빌 때까지 처리) ──────────────────────────────
if [[ -n "${VERCEL_URL:-}" ]]; then
  echo "[$TIMESTAMP] AI 큐 드레인 시작..." | tee -a "$LOG_FILE"
  AUTH_HEADER=""
  if [[ -n "${CRON_SECRET:-}" ]]; then
    AUTH_HEADER="-H \"Authorization: Bearer $CRON_SECRET\""
  fi
  DRAIN_RESPONSE=$(curl -s --max-time 310 \
    -X POST \
    ${CRON_SECRET:+-H "Authorization: Bearer $CRON_SECRET"} \
    "$VERCEL_URL/api/admin/ingestion/queue/drain" 2>&1) || true
  echo "[$TIMESTAMP] AI 큐 드레인 결과: $DRAIN_RESPONSE" | tee -a "$LOG_FILE"
else
  echo "[$TIMESTAMP] VERCEL_URL 미설정 — AI 큐 드레인 건너뜀" | tee -a "$LOG_FILE"
fi
