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
  # 레거시 보조 스크래퍼 실패는 비치명적 — 핵심 TS 파이프라인은 계속 실행한다.
  echo "[$TIMESTAMP] ⚠️ Python 스크래퍼 실패 (exit $EXIT_CODE) — TS 파이프라인은 계속 진행" | tee -a "$LOG_FILE"
fi

# ── 전체 파이프라인 실행 (stagepick 크롤 + sweep + fix + delete + enrich + merge) ──
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
echo "[$TIMESTAMP] 파이프라인 실행 시작..." | tee -a "$LOG_FILE"
cd "$REPO_DIR"
NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_KEY" \
npx tsx scripts/pipeline/run.ts 2>&1 | tee -a "$LOG_FILE"
PIPELINE_EXIT=${PIPESTATUS[0]}
if [[ $PIPELINE_EXIT -eq 0 ]]; then
  echo "[$TIMESTAMP] 파이프라인 완료" | tee -a "$LOG_FILE"
else
  echo "[$TIMESTAMP] 파이프라인 실패 (exit $PIPELINE_EXIT)" | tee -a "$LOG_FILE"
fi
