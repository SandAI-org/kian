#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  migrate_codex_sessions_between_containers.sh \
    --source OLD --target NEW --workspace-dir PATH [--dry-run]

Safely transfers Codex history between two running Docker Dev Containers on the
same host and backed by the same physical workspace path. The target must not
already contain Codex threads; this script fails closed instead of attempting an
unsafe SQLite merge.
EOF
}

SOURCE=""
TARGET=""
WORKSPACE_DIR=""
DRY_RUN=0
BACKUP_BASE="${HOME}/codex-migration-backups"
CODEX_HOME="/root/.codex"

while (($#)); do
  case "$1" in
    --source) SOURCE=${2:?missing value for --source}; shift 2 ;;
    --target) TARGET=${2:?missing value for --target}; shift 2 ;;
    --workspace-dir) WORKSPACE_DIR=${2:?missing value for --workspace-dir}; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --backup-base) BACKUP_BASE=${2:?missing value for --backup-base}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$SOURCE" && -n "$TARGET" && -n "$WORKSPACE_DIR" ]] || { usage >&2; exit 2; }
[[ "$SOURCE" != "$TARGET" ]] || { echo "Source and target must differ" >&2; exit 2; }
[[ "$WORKSPACE_DIR" == /* ]] || { echo "--workspace-dir must be an absolute path inside both containers" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }
command -v python3 >/dev/null || { echo "host python3 not found" >&2; exit 1; }

for container in "$SOURCE" "$TARGET"; do
  docker inspect "$container" >/dev/null 2>&1 || { echo "Container not found: $container" >&2; exit 1; }
  [[ $(docker inspect -f '{{.State.Running}}' "$container") == true ]] || { echo "Container is not running: $container" >&2; exit 1; }
  docker exec "$container" test -d "$CODEX_HOME" || { echo "Codex home is missing in $container: $CODEX_HOME" >&2; exit 1; }
  docker exec "$container" test -d "$WORKSPACE_DIR" || { echo "Workspace is missing in $container: $WORKSPACE_DIR" >&2; exit 1; }
done

resolve_host_workspace() {
  local container=$1
  docker inspect "$container" | python3 -c '
import json
import posixpath
import sys
workspace = posixpath.normpath(sys.argv[1])
inspect = json.load(sys.stdin)[0]
candidates = []
for mount in inspect.get("Mounts", []):
    if mount.get("Type") != "bind":
        continue
    destination = posixpath.normpath(mount.get("Destination", ""))
    if workspace == destination or workspace.startswith(destination.rstrip("/") + "/"):
        candidates.append((len(destination), destination, mount.get("Source", "")))
if not candidates:
    raise SystemExit("workspace is not covered by a bind mount")
_, destination, source = max(candidates)
relative = posixpath.relpath(workspace, destination)
print(posixpath.normpath(source if relative == "." else posixpath.join(source, relative)))
' "$WORKSPACE_DIR"
}

source_host_workspace=$(resolve_host_workspace "$SOURCE") || { echo "Cannot resolve source workspace bind mount" >&2; exit 1; }
target_host_workspace=$(resolve_host_workspace "$TARGET") || { echo "Cannot resolve target workspace bind mount" >&2; exit 1; }
[[ "$source_host_workspace" == "$target_host_workspace" ]] || {
  echo "Containers do not map the workspace to the same host path" >&2
  echo "source_host_workspace=$source_host_workspace" >&2
  echo "target_host_workspace=$target_host_workspace" >&2
  exit 1
}
[[ -d "$source_host_workspace" ]] || { echo "Resolved host workspace does not exist: $source_host_workspace" >&2; exit 1; }
printf 'workspace=%s host_path=%s\n' "$WORKSPACE_DIR" "$source_host_workspace"

sqlite_scalar() {
  local container=$1 db=$2 sql=$3
  docker exec -i "$container" python3 - "$db" "$sql" <<'PY'
import sqlite3
import sys
path, sql = sys.argv[1], sys.argv[2]
try:
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as con:
        row = con.execute(sql).fetchone()
    print(row[0] if row else 0)
except sqlite3.OperationalError as exc:
    if "unable to open database file" in str(exc):
        print(0)
    else:
        raise
PY
}

source_threads=$(sqlite_scalar "$SOURCE" "$CODEX_HOME/state_5.sqlite" 'select count(*) from threads')
target_threads=$(sqlite_scalar "$TARGET" "$CODEX_HOME/state_5.sqlite" 'select count(*) from threads')
source_rollouts=$(docker exec "$SOURCE" sh -lc "find '$CODEX_HOME/sessions' -type f -name 'rollout-*.jsonl' 2>/dev/null | wc -l")
target_rollouts=$(docker exec "$TARGET" sh -lc "find '$CODEX_HOME/sessions' -type f -name 'rollout-*.jsonl' 2>/dev/null | wc -l")

printf 'source=%s threads=%s rollouts=%s\n' "$SOURCE" "$source_threads" "$source_rollouts"
printf 'target=%s threads=%s rollouts=%s\n' "$TARGET" "$target_threads" "$target_rollouts"

(( source_threads > 0 )) || { echo "Source has no Codex threads; aborting" >&2; exit 1; }
(( source_rollouts > 0 )) || { echo "Source has no Codex rollout files; aborting" >&2; exit 1; }
if (( target_threads > 0 || target_rollouts > 0 )); then
  cat >&2 <<EOF
Target already contains Codex history (threads=$target_threads, rollouts=$target_rollouts).
This script intentionally refuses to overwrite or naively merge live Codex SQLite
state. Preserve the target and perform a separately reviewed merge procedure.
EOF
  exit 1
fi

if (( DRY_RUN )); then
  echo "dry-run passed; no data changed"
  exit 0
fi

stop_codex_app_server() {
  local container=$1
  docker exec "$container" sh -lc '
    pids=$(ps -eo pid,args | awk "/[/]codex .*app-server/{print \$1}")
    [ -z "$pids" ] && exit 0
    kill -TERM $pids
    for _ in $(seq 1 20); do
      alive=0
      for pid in $pids; do kill -0 "$pid" 2>/dev/null && alive=1; done
      [ "$alive" -eq 0 ] && exit 0
      sleep 1
    done
    echo "Codex app-server did not stop cleanly" >&2
    exit 1
  '
}

assert_codex_stopped() {
  local container=$1
  if docker exec "$container" sh -lc 'ps -eo args | grep -qE "[/]codex .*app-server"'; then
    echo "Codex app-server is running in $container; aborting" >&2
    exit 1
  fi
}

stop_codex_app_server "$SOURCE"
stop_codex_app_server "$TARGET"
assert_codex_stopped "$SOURCE"
assert_codex_stopped "$TARGET"

stamp=$(date +%Y%m%d-%H%M%S)
backup="$BACKUP_BASE/$stamp"
mkdir -p "$backup/source" "$backup/target"
docker cp "$SOURCE:$CODEX_HOME" "$backup/source/.codex" >/dev/null
docker cp "$TARGET:$CODEX_HOME" "$backup/target/.codex" >/dev/null
chmod -R go-rwx "$backup"
echo "backup=$backup"

assert_codex_stopped "$SOURCE"
assert_codex_stopped "$TARGET"

for container in "$SOURCE" "$TARGET"; do
  docker exec -i "$container" python3 - "$CODEX_HOME" <<'PY'
import sqlite3
import sys
from pathlib import Path
root = Path(sys.argv[1])
for path in (root / "state_5.sqlite", root / "thread_history_1.sqlite"):
    if not path.exists():
        continue
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as con:
        result = con.execute("pragma integrity_check").fetchone()[0]
    if result != "ok":
        raise SystemExit(f"{path}: integrity_check={result}")
PY
done

docker exec "$TARGET" sh -lc "
  rm -rf '$CODEX_HOME/sessions' '$CODEX_HOME/shell_snapshots' '$CODEX_HOME/thread-writer-locks' '$CODEX_HOME/rollout-migrations'
  rm -f '$CODEX_HOME'/state_5.sqlite* '$CODEX_HOME'/thread_history_1.sqlite* '$CODEX_HOME/session_index.jsonl'
  mkdir -p '$CODEX_HOME'
"

items=(sessions shell_snapshots thread-writer-locks rollout-migrations state_5.sqlite thread_history_1.sqlite session_index.jsonl)
for item in "${items[@]}"; do
  if docker exec "$SOURCE" test -e "$CODEX_HOME/$item"; then
    docker exec "$SOURCE" tar -C "$CODEX_HOME" -cf - "$item" | docker exec -i "$TARGET" tar -C "$CODEX_HOME" -xf -
  fi
done

docker exec "$TARGET" sh -lc "
  rm -rf '$CODEX_HOME/ipc'
  find '$CODEX_HOME/thread-writer-locks' -type f -name '*.lock' -delete 2>/dev/null || true
  mkdir -p '$CODEX_HOME/thread-writer-locks'
  chmod 700 '$CODEX_HOME'
  find '$CODEX_HOME/sessions' '$CODEX_HOME/shell_snapshots' '$CODEX_HOME/thread-writer-locks' -type d -exec chmod 700 {} + 2>/dev/null || true
  find '$CODEX_HOME/sessions' '$CODEX_HOME/shell_snapshots' -type f -exec chmod 600 {} + 2>/dev/null || true
"

docker exec -i "$TARGET" python3 - "$CODEX_HOME" <<'PY'
import sqlite3
import sys
from pathlib import Path
root = Path(sys.argv[1])
state = root / "state_5.sqlite"
history = root / "thread_history_1.sqlite"
with sqlite3.connect(f"file:{state}?mode=ro", uri=True) as con:
    state_integrity = con.execute("pragma integrity_check").fetchone()[0]
    threads = con.execute("select count(*) from threads").fetchone()[0]
    rollout_paths = [row[0] for row in con.execute("select rollout_path from threads")]
with sqlite3.connect(f"file:{history}?mode=ro", uri=True) as con:
    history_integrity = con.execute("pragma integrity_check").fetchone()[0]
    turns = con.execute("select count(*) from thread_turns").fetchone()[0]
    items = con.execute("select count(*) from thread_items").fetchone()[0]
rollout_files = sum(1 for path in (root / "sessions").rglob("rollout-*.jsonl") if path.is_file())
missing = [path for path in rollout_paths if path and not Path(path).exists()]
print(f"state_integrity={state_integrity}")
print(f"threads={threads}")
print(f"history_integrity={history_integrity}")
print(f"turns={turns}")
print(f"items={items}")
print(f"rollout_files={rollout_files}")
print(f"missing_rollouts={len(missing)}")
if state_integrity != "ok" or history_integrity != "ok" or threads == 0 or rollout_files == 0 or missing:
    raise SystemExit("Codex migration validation failed; restore the target backup")
PY

echo "migration completed successfully"
echo "Reload the VS Code window connected to $TARGET to restart Codex app-server."
