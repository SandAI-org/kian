#!/bin/bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTOMATION_HOME="${KIAN_AUTOMATION_HOME:-$HOME/.config/kian-automation}"
CONFIG_FILE="$AUTOMATION_HOME/config/config.json"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
failures=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }

[[ "$(uname -s)" == "Darwin" ]] && pass "macOS" || fail "macOS is required"
command -v node >/dev/null 2>&1 && pass "node available" || fail "node missing"
command -v python3 >/dev/null 2>&1 && pass "python3 available" || fail "python3 missing"

if [[ -f "$CONFIG_FILE" ]]; then
  if python3 -m json.tool "$CONFIG_FILE" >/dev/null 2>&1; then pass "config JSON valid"; else fail "config JSON invalid"; fi
  placeholder_count="$(grep -o 'REPLACE_WITH_' "$CONFIG_FILE" 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$placeholder_count" == "0" ]]; then
    pass "config has no placeholders"
  else
    echo "INFO: config has $placeholder_count placeholder(s); placeholders in disabled or unused features are allowed"
  fi
  permissions="$(stat -f '%Lp' "$CONFIG_FILE" 2>/dev/null || true)"
  [[ "$permissions" == "600" ]] && pass "config permissions are 600" || fail "config permissions should be 600"
else
  fail "private config missing"
fi

for directory in state logs; do
  [[ -d "$AUTOMATION_HOME/$directory" ]] && pass "$directory directory exists" || fail "$directory directory missing"
done

for service in bridge realtime daily qr; do
  plist="$LAUNCH_AGENTS/com.kian.$service.plist"
  if [[ -f "$plist" ]]; then
    plutil -lint "$plist" >/dev/null 2>&1 && pass "com.kian.$service plist valid" || fail "com.kian.$service plist invalid"
    if launchctl print "gui/$(id -u)/com.kian.$service" >/dev/null 2>&1; then
      pass "com.kian.$service registered"
    else
      fail "com.kian.$service plist exists but is not registered"
    fi
  else
    echo "INFO: com.kian.$service not installed"
  fi
done

for label in com.kian.copilot-bridge com.kian.github-monitor com.kian.github-monitor-daily com.kian.reminder-qr; do
  plist="$LAUNCH_AGENTS/$label.plist"
  if [[ -f "$plist" ]] || launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    fail "legacy $label is still installed; rerun automation/bin/install.sh to prevent duplicate service execution"
  fi
done

log_count="$(find "$AUTOMATION_HOME/logs" -type f 2>/dev/null | wc -l | tr -d ' ')"
echo "INFO: log files present: $log_count (contents hidden)"

if (( failures > 0 )); then
  echo "Doctor found $failures issue(s)." >&2
  exit 1
fi
echo "Doctor checks passed."
