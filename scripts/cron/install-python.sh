#!/bin/bash
# Articket Python 스크래퍼 로컬 Cron 설치
# 오전 6시 + 오후 6시, 전체 사이트 자동 실행

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_LABEL="com.articket.cron.python"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   Articket Python 스크래퍼 Cron 설치  ║"
echo "╚════════════════════════════════════════╝"
echo ""

# ── 1. .cron-python.env 설정 ───────────────────────────────────────────────
if [[ -f "$SCRIPT_DIR/.cron-python.env" ]]; then
  echo "기존 .cron-python.env 발견."
  echo -n "덮어쓰기? (y/N) "
  read -r OVERWRITE
  if [[ "$OVERWRITE" != "y" && "$OVERWRITE" != "Y" ]]; then
    echo "기존 설정 유지."
  else
    rm "$SCRIPT_DIR/.cron-python.env"
  fi
fi

if [[ ! -f "$SCRIPT_DIR/.cron-python.env" ]]; then
  echo "Supabase URL (예: https://xxxx.supabase.co):"
  read -r INPUT_URL
  echo "Supabase service_role 키:"
  read -r -s INPUT_KEY
  echo ""

  PYTHON_BIN="$(which python3 2>/dev/null || echo '/opt/homebrew/bin/python3')"
  echo "Python 경로 (엔터 = $PYTHON_BIN):"
  read -r INPUT_PYTHON
  PYTHON_BIN="${INPUT_PYTHON:-$PYTHON_BIN}"

  cat > "$SCRIPT_DIR/.cron-python.env" << EOF
SUPABASE_URL="${INPUT_URL%/}"
SUPABASE_SERVICE_KEY="$INPUT_KEY"
PYTHON_BIN="$PYTHON_BIN"
EOF
  chmod 600 "$SCRIPT_DIR/.cron-python.env"
  echo "✔  .cron-python.env 생성 완료"
fi

# ── 2. 기존 job 제거 ───────────────────────────────────────────────────────
if launchctl list 2>/dev/null | grep -q "$PLIST_LABEL"; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# ── 3. plist 생성 (오전 6시 + 오후 6시) ───────────────────────────────────
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${SCRIPT_DIR}/trigger-python.sh</string>
    </array>

    <!-- 오전 6시 + 오후 6시 2회 실행 -->
    <key>StartCalendarInterval</key>
    <array>
        <dict>
            <key>Hour</key>
            <integer>6</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Hour</key>
            <integer>18</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
    </array>

    <key>RunAtLoad</key>
    <false/>

    <key>StandardOutPath</key>
    <string>${HOME}/Library/Logs/articket-python-cron.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/Library/Logs/articket-python-cron-error.log</string>
</dict>
</plist>
PLIST

# ── 4. launchd 등록 ────────────────────────────────────────────────────────
launchctl load "$PLIST_PATH"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   ✅ 설치 완료!                        ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "  스케줄  : 오전 6시 + 오후 6시 (전체 사이트)"
echo "  로그    : tail -f ~/Library/Logs/articket-python-cron.log"
echo "  즉시 테스트: bash $SCRIPT_DIR/trigger-python.sh"
echo "  제거    : bash $SCRIPT_DIR/uninstall-python.sh"
echo ""
