#!/bin/bash
# Articket Python 스크래퍼 Cron 제거

PLIST_LABEL="com.articket.cron.python"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

echo "Articket Python Cron 제거 중..."

if launchctl list 2>/dev/null | grep -q "$PLIST_LABEL"; then
  launchctl unload "$PLIST_PATH" 2>/dev/null && echo "✔  launchd job 중지됨"
fi

if [[ -f "$PLIST_PATH" ]]; then
  rm "$PLIST_PATH" && echo "✔  plist 삭제됨"
fi

echo ""
echo "✅ 제거 완료. .cron-python.env는 보존됩니다."
echo "   재설치: bash scripts/cron/install-python.sh"
