#!/bin/bash
set -euo pipefail

LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
for service in bridge realtime daily qr; do
  plist="$LAUNCH_AGENTS/com.kian.$service.plist"
  launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  rm -f "$plist"
  echo "Removed com.kian.$service"
done

echo "Private config, state, and logs were preserved."
