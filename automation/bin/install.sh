#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: this installer supports macOS only" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AUTOMATION_HOME="${KIAN_AUTOMATION_HOME:-$HOME/.config/kian-automation}"
CONFIG_DIR="$AUTOMATION_HOME/config"
STATE_DIR="$AUTOMATION_HOME/state"
LOG_DIR="$AUTOMATION_HOME/logs"
CONFIG_FILE="$CONFIG_DIR/config.json"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PYTHON_BIN="$(command -v python3 || true)"
NODE_BIN="$(command -v node || true)"

[[ -n "$PYTHON_BIN" ]] || { echo "ERROR: python3 is required" >&2; exit 1; }
[[ -n "$NODE_BIN" ]] || { echo "ERROR: node is required" >&2; exit 1; }

mkdir -p "$CONFIG_DIR" "$STATE_DIR" "$LOG_DIR" "$LAUNCH_AGENTS"
chmod 700 "$AUTOMATION_HOME" "$CONFIG_DIR" "$STATE_DIR" "$LOG_DIR"
if [[ ! -f "$CONFIG_FILE" ]]; then
  cp "$REPO_ROOT/automation/config/config.example.json" "$CONFIG_FILE"
  echo "Created private configuration: $CONFIG_FILE"
else
  echo "Preserved existing private configuration: $CONFIG_FILE"
fi
chmod 600 "$CONFIG_FILE"

if command -v pnpm >/dev/null 2>&1; then
  CI=1 HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= http_proxy= https_proxy= all_proxy= \
    npm_config_proxy= npm_config_https_proxy= \
    pnpm --config.proxy= --config.https-proxy= \
    --dir "$REPO_ROOT/packages/kian-copilot-bridge" install --ignore-workspace --frozen-lockfile
else
  HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= http_proxy= https_proxy= all_proxy= \
    npm_config_proxy= npm_config_https_proxy= \
    npm --prefix "$REPO_ROOT/packages/kian-copilot-bridge" install --no-audit --no-fund
fi

read_config() {
  "$PYTHON_BIN" - "$CONFIG_FILE" "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
value = data
for part in sys.argv[2].split("."):
    value = value.get(part, {}) if isinstance(value, dict) else {}
if value == {}:
    value = sys.argv[3]
if isinstance(value, bool):
    print("true" if value else "false")
else:
    print(value)
PY
}

service_ready() {
  "$PYTHON_BIN" - "$CONFIG_FILE" "$1" <<'PY'
import json, sys

with open(sys.argv[1], encoding="utf-8") as handle:
  config = json.load(handle)

service = sys.argv[2]
required = {
  "bridge": ["feishu.app_id", "feishu.app_secret", "feishu.open_id"],
  "realtime": ["feishu.app_id", "feishu.app_secret", "feishu.open_id", "github.repos", "github.tokens"],
  "daily": ["feishu.app_id", "feishu.app_secret", "feishu.open_id", "github.repos", "github.tokens"],
  "qr": ["feishu.app_id", "feishu.app_secret", "feishu.open_id", "qr_publish.reminder_title", "qr_publish.reminder_body"],
}[service]

def get(path):
  value = config
  for part in path.split("."):
    value = value.get(part) if isinstance(value, dict) else None
  return value

def unresolved(value):
  if value in (None, "", [], {}):
    return True
  if isinstance(value, str):
    return value.startswith("REPLACE_WITH_")
  if isinstance(value, list):
    return any(unresolved(item) for item in value)
  if isinstance(value, dict):
    return any(unresolved(key) or unresolved(item) for key, item in value.items())
  return False

missing = [path for path in required if unresolved(get(path))]
if missing:
  print(", ".join(missing))
  raise SystemExit(1)
PY
}

render() {
  local service="$1" template="$REPO_ROOT/automation/launchd/com.kian.$service.plist.template"
  local output="$LAUNCH_AGENTS/com.kian.$service.plist"
  sed \
    -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
    -e "s|__AUTOMATION_HOME__|$AUTOMATION_HOME|g" \
    -e "s|__PYTHON__|$PYTHON_BIN|g" \
    -e "s|__NODE__|$NODE_BIN|g" \
    "$template" > "$output"
  if [[ "$service" == "realtime" ]]; then
    /usr/libexec/PlistBuddy -c "Set :StartInterval $(read_config services.realtime.interval_seconds 300)" "$output"
  elif [[ "$service" == "daily" ]]; then
    /usr/libexec/PlistBuddy -c "Set :StartCalendarInterval:Hour $(read_config services.daily.hour 10)" "$output"
    /usr/libexec/PlistBuddy -c "Set :StartCalendarInterval:Minute $(read_config services.daily.minute 0)" "$output"
  elif [[ "$service" == "qr" ]]; then
    /usr/libexec/PlistBuddy -c "Set :StartCalendarInterval:Hour $(read_config services.qr.hour 12)" "$output"
    /usr/libexec/PlistBuddy -c "Set :StartCalendarInterval:Minute $(read_config services.qr.minute 0)" "$output"
  fi
  chmod 600 "$output"
  plutil -lint "$output" >/dev/null
}

DOMAIN="gui/$(id -u)"
for service in bridge realtime daily qr; do
  plist="$LAUNCH_AGENTS/com.kian.$service.plist"
  launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  if [[ "$(read_config services.$service.enabled false)" == "true" ]]; then
    render "$service"
    if missing="$(service_ready "$service")"; then
      launchctl bootstrap "$DOMAIN" "$plist"
      echo "Enabled com.kian.$service"
    else
      echo "Rendered com.kian.$service (not loaded; configure: $missing)"
    fi
  else
    rm -f "$plist"
    echo "Disabled com.kian.$service"
  fi
done

echo "Install complete. Edit $CONFIG_FILE, then rerun this installer and automation/bin/doctor.sh."
