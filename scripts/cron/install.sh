#!/bin/bash
# Articket 로컬 Cron 설치 스크립트
# macOS launchd를 이용해 매시간 정각에 크롤러를 자동 실행합니다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_LABEL="com.articket.cron"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   Articket 로컬 Cron 설치              ║"
echo "╚════════════════════════════════════════╝"
echo ""

# ── 1. .cron.env 설정 ──────────────────────────────────────────────────────
if [[ -f "$SCRIPT_DIR/.cron.env" ]]; then
  echo "기존 .cron.env 발견."
  echo -n "덮어써서 재설정할까요? (y/N) "
  read -r OVERWRITE
  if [[ "$OVERWRITE" != "y" && "$OVERWRITE" != "Y" ]]; then
    echo "기존 설정을 유지합니다."
  else
    rm "$SCRIPT_DIR/.cron.env"
  fi
fi

if [[ ! -f "$SCRIPT_DIR/.cron.env" ]]; then
  echo "Vercel 배포 URL (예: https://articket-admin.vercel.app):"
  read -r INPUT_URL
  # 끝의 슬래시 제거
  VERCEL_URL="${INPUT_URL%/}"

  echo "CRON_SECRET (없으면 그냥 엔터):"
  read -r -s INPUT_SECRET
  echo ""
  CRON_SECRET="${INPUT_SECRET:-}"

  cat > "$SCRIPT_DIR/.cron.env" << EOF
VERCEL_URL="$VERCEL_URL"
CRON_SECRET="$CRON_SECRET"
EOF
  chmod 600 "$SCRIPT_DIR/.cron.env"
  echo "✔  .cron.env 생성 완료 (git 추적 제외됨)"
fi

# ── 2. 기존 launchd job 제거 ───────────────────────────────────────────────
if launchctl list 2>/dev/null | grep -q "$PLIST_LABEL"; then
  echo "기존 launchd job 제거 중..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# ── 3. plist 생성 ──────────────────────────────────────────────────────────
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- 매시간 정각 실행 (Vercel Free cron 대체) -->
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${SCRIPT_DIR}/trigger.sh</string>
    </array>

    <!-- 매시간 정각 (0분) -->
    <key>StartCalendarInterval</key>
    <dict>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <!-- Mac이 잠자기 상태에서 놓친 실행은 깨어날 때 자동 실행 -->
    <key>RunAtLoad</key>
    <false/>

    <key>StandardOutPath</key>
    <string>${HOME}/Library/Logs/articket-cron.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/Library/Logs/articket-cron-error.log</string>
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
echo "  스케줄  : 매시간 정각 (Mac 절전 중 놓치면 깨울 때 즉시 실행)"
echo "  로그    : tail -f ~/Library/Logs/articket-cron.log"
echo "  즉시 테스트: bash $SCRIPT_DIR/trigger.sh"
echo "  제거    : bash $SCRIPT_DIR/uninstall.sh"
echo ""
