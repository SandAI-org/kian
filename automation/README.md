# Portable Kian Automation

The supplement reminder runs at **14:00 Asia/Shanghai on eligible working days**, using the shared work/leave/holiday calendar gate.

This directory packages the GitHub-to-Feishu monitor, PR description manager, reminders, file transfer helper, QR publisher, Feishu bridge, and macOS `launchd` integration without storing private runtime data in Git.

Acknowledgement-required recurring reminders live in the private `config.json` under `reminders`. Each reminder has its own schedule, confirmation label, and repeat interval. Once due, it repeats until an authorized user clicks its card button. State is keyed by reminder ID and occurrence date under `state/ack-reminders/`, so an old card cannot acknowledge a newer occurrence. `services.reminders.poll_interval_seconds` controls scheduler checks; each reminder's `repeat_interval_seconds` controls nag frequency.

The installer stages Python runtime scripts under the private `~/.config/kian-automation/runtime/` directory, and LaunchAgents execute that copy to avoid macOS background-access restrictions on folders such as `Documents`. Kian remains the source of truth, and each install refreshes the runtime copy.

### Important public-repository updates

Within each repository, required events (releases, eligible PR outcomes, followed-item updates and registered blog/image releases) appear before score-selected early PR/Issue signals. Scored signals sort by descending score; ties and required events keep their original relative order. Repeated repository groups are merged and sorted before the 25-event batch limit, including quiet-hour backlog and retries. Older queued cards derive priority from their existing early-signal heading. Repository order and event eligibility are unchanged.

`public_watch.repositories` observes public repositories that you do not maintain. It is isolated from the full-fidelity owned-repository monitor and silently creates a baseline on first run instead of replaying history. Releases and PRs merged into `integration_branches` are always reported; without an override, the GitHub `default_branch` is used. Early important PR/Issue signals are scored from security, correctness/regression, breaking API, performance, hardware/compiler semantics, GitHub labels, maintainer authorship, discussion, and reaction activity.

A repository can also declare `blogs` entries with `name` and `feed_url`. Each RSS/Atom feed is baselined independently, so enabling it does not replay old posts; later posts are rendered as Blog events with Chinese summaries and grouped under the owning repository in the same durable Feishu batch. Repository title/body exclusion rules also apply to posts. Feed state is kept separately from GitHub PR/Issue state, and up to 200 seen item identifiers are retained per feed.

Independent research blogs belong in `public_watch.sources`, with a unique `id`, display `name`, and either `feed_url` (RSS/Atom) or `index_url` plus `link_pattern` matching article URL paths. HTML discovery accepts titled same-origin HTTPS article links, deduplicates them, and fetches new detail pages for summaries; an empty match is an error, preserving the previous baseline. Sources share hourly scans, quiet hours, durable batching and delivery retry with repositories, but have separate checkpoints under `sources` and a “Research blog” card section without a GitHub branch. All newly discovered non-excluded posts are reported; repository PR/Issue scoring levels do not apply. `exclude` title/body rules remain available. First registration baselines existing articles without sending history; subsequent content edits to an already seen URL are not re-notified. The monitored coverage is the official index/feed, not the site's entire archive. Add future OpenAI/DeepMind blogs as independent sources after validating their official feed/index; registration is explicit. The example registers Anthropic Research.

For documentation sites without feeds, `web_releases` accepts `name`, `index_url`, and a regular-expression `link_pattern` containing a named `version` group (or a first capture group). Matching links are baselined independently; a newly listed version is always emitted as a release event, and its detail page supplies the Chinese-summary context. This is intended for vendor artifacts associated with a repository, such as NVIDIA PyTorch NGC container release notes.

Per-repository `level` is adjustable: `detailed` uses a default PR/Issue threshold of 4, `balanced` uses 8, and `essential` disables early signals while retaining releases and integration-branch merges. `thresholds.pr` and `thresholds.issue` override either value. Once an early signal is reported, its merge/close or Issue state outcome remains tracked even if the level is later reduced. State lives in `state/public-watch-state.json`.

Public-repository cards deliberately contain no management buttons. The user sends a GitHub PR/Issue link plus a natural-language instruction to an agent, such as “持续关注”, “取消关注”, “加入备忘录”, or “深度调研”. Agents persist the durable item in `ai-agent-contexts`; when Kian runtime access is available, they mirror follow state with `automation/scripts/manage_public_watch.py pin|unpin <url>`. Only explicitly pinned items are re-notified: PRs on head commit changes, including rebases or force-pushes, and Issues on new comments or title, body, and label changes. Follow-up cards include a synthetic `pinned` label. A final PR merge/close or Issue close notification automatically completes the pin. Runtime pin state remains isolated under `state/public-watch-pins/<owner>/<repo>/<number>.json`, and an active pin overrides repository level and noise filters.

Open-source repository delivery is durably batched. Events found from `00:00` through `10:29` Asia/Shanghai are queued in `state/public-watch-state.json` and flushed by an exact `10:30` calendar trigger; a failed send leaves the queue intact and is retried every five minutes, while actual GitHub scans remain hourly. During daytime runs, events from multiple repositories are combined into one Feishu card, and repeated batches for the same repository share one section. To stay within Feishu card limits, an extreme backlog sends at most 25 events per retry point and retains the rest.

Per-repository `exclude` rules accept regular expressions in `title_patterns`, `body_patterns`, legacy combined `text_patterns`, `label_patterns`, and `path_patterns`. Separate title and body rules prevent incidental compatibility notes from excluding an otherwise relevant PR. Path filtering defaults to `path_match: "all"`, so a PR is excluded by paths only when every changed file belongs to an excluded backend; set it to `any` for aggressive filtering. Custom exclusions apply to early signals and integration-branch merges, but never suppress releases. PR cards render title, Chinese summary, one merged English Signals line, and the source link in that order, without repeating the English body or ghstack inventory.

## Private/runtime boundary

### On-demand Magicore image cleanup

Publishing and local cache reclamation are separate. The current rewrite worker removes its temporary containers/preview aliases but retains pulled and verification images. Close out an authorized batch with the user-selected local keep set: derive exact tag/image identities from its receipts or curated digest ledger, recheck container references and current tag identity, and remove only those references without force. Preserve the kept tag even when another removable alias shares its image ID; verify every unrelated local reference is unchanged afterwards. Do not use global prune, delete registry tags, or claim reclaimed space by summing per-tag sizes, which share layers. Long local-cache reclamation must appear on the common task dashboard.

Non-commit aliases are excluded by default. After the user explicitly authorizes specific aliases, repeat `--allow-alias <tag>` for each and include those entries in the private plan with `commit: null`, a sort timestamp, and an `expected_digest` captured during inventory. The worker resolves the exact image Git HEAD without treating the alias as a commit prefix; hexadecimal commit tags retain their prefix check. For an alias pointing to the exact original digest of an already-verified item, `reuse_tag` may reuse its checked manifest/config/layers after verifying both source identities. This only changes the alias reference and still performs pull verification. Expanded plans preserve existing progress and receipts; a moving alias is not overwritten if its digest changed since inventory.

For an explicitly authorized alias without image Git metadata, a manually reviewed plan may supply `tracked_roots` plus `source_review.workspace_entries` (the exact reviewed root listing). The worker requires an unknown commit, refuses newly present Git metadata or any inventory mismatch before deletion, and records the review with `commit: null`; never invent a commit from the alias. The same runtime, retained-content, layer and publication checks still apply.

The fixed progress entrance `http://127.0.0.1:8767/` is the shared **Background tasks** page; `/images` retains the detailed image-cleanup view. Every `file_transfer.py` CLI invocation automatically creates a private task record under `state/background-tasks/<uuid>.json`. Downloads, uploads and staged remote-to-remote sync show phases, retries, byte counts, rsync speed/ETA and verification results. A single file is completed only after size/SHA-256 verification; a directory reports rsync checks, not an unperformed whole-tree SHA-256. Directory rsync percentages refer to the current file, never fabricated aggregate progress. The page shows active jobs first, filters completed/issues, keeps up to the latest 100 records visible and refreshes every five seconds. If its progress process disappears or its PID is reused, the displayed state becomes unconfirmed rather than success; the underlying command may still be running. Records are written atomically with mode 600.

Other locally orchestrated long operations can use the same agent-only interface, without another dashboard or port:

```python
from background_tasks import BackgroundTask

with BackgroundTask("Describe the operation", "operation-kind") as task:
    task.update(stage="running", progress_percent=25)
    # Perform the operation and validate its result before leaving the context.
```

An exception records failure/interruption. Do not invent a percentage when the operation has no measurable total; publish its stage instead. Remote independent workers need a read-only status adapter, like the image batch, because a Mac process exiting does not establish remote task completion. The existing `image_cleanup_dashboard` service/config name is retained for deployment; it can serve local tasks without a remote host/state directory. Future agent-started transfers use this automatic entry point; other long tasks should explicitly use the shared progress interface. The user only needs the fixed link.

For a clickable live view, enable `services.image_cleanup_dashboard.enabled` and configure `image_cleanup_dashboard.host`, remote `state_dir`, optional local `port` (8767), `poll_seconds` (15), and `language` (`zh` or `en`). The persistent `com.kian.image_cleanup_dashboard` LaunchAgent serves `http://127.0.0.1:8767/`; install, doctor and uninstall include it. It polls sanitized status over read-only SSH and shows progress, active stages, recent completions, issues and observation times. Connection failures retain the last snapshot with an offline warning. The page refreshes every ten seconds; it cannot mutate the batch and binds only to Mac loopback. Mac sleep/offline makes the page unavailable or stale, while the detached H200 batch continues. A phone cannot access its own localhost to reach this Mac service.

`automation/scripts/cleanup_magicore_images.py` runs on the explicitly selected Docker host. Supply `--repository <registry/project/image> --plan <private-plan.json> --state-dir <private-state-dir>`; without `--apply` it only shows the ordered plan. Entries contain hexadecimal `tag`, full `commit`, integer `commit_time`, and the corresponding Git `tracked_roots`. `--unresolved <private-tags.json>` appends unresolved commit tags after dated entries and resolves their exact Git HEAD and tracked roots from the pulled image, requiring the HEAD to match the tag. Non-commit aliases are not included. Use `--workers 2 --apply` only after publication is authorized.

The worker removes visible tracked Magicore workspace entries, `.git`, `Megatron-LM`, and `Mooncake`, preserving and hashing other workspace content (including nccl-tests). Old source remains recoverable in earlier image layers by design. It checks package inventory/imports, runtime configuration, platform, original layers and workspace-only filesystem changes before publishing Docker V2 manifests with unchanged blob identities. Each remote tag is rechecked against its input digest before replacement; pulled output is verified afterwards. This does not sync other registries or modify running containers. Unsupported layouts, mounts, import changes and tag races fail that item without forcing publication. No GPU compute test is implied.

Plans, registry credentials, metadata, per-tag receipts and `status.json`/`events.jsonl` remain private. Re-running the same state directory skips verified published digests and can finish verification of a recorded publication. A single batch lock prevents concurrent runners sharing that state; graceful SIGTERM finishes active tags, then stops dispatch. The default 200 GiB free-space guard pauses new work; shared Docker images/containers are never globally pruned. Run the approved batch as a detached remote process to survive Mac sleep or SSH disconnection; poll its private status for progress. Successful tags may still occupy local disk, so check free space and explicitly manage job-owned cache if needed.

The repository contains code, templates, and placeholder-only examples. The default private home is `~/.config/kian-automation` (override with `KIAN_AUTOMATION_HOME`):

- `config/config.json`: credentials, repository list, SSH aliases, paths, and service settings; mode `600`.
- `state/`: monitor checkpoints, managed PR records, connection health, and reminder state.
- `logs/`: service output.

Never commit private configuration, state, logs, tokens, Feishu IDs, machine addresses, user names, absolute personal paths, or SSH configuration. Keep `~/.ssh/config` and private keys outside the repository. State migration is optional; omit it for a clean start.

## Information to collect on a new Mac

Ask the operator specifically for:

1. Feishu app ID, app secret, notification recipient open ID, and every allowed user's open ID.
2. GitHub repositories as `owner/repo` and a token per owner.
3. Summarization backend. The recommended `copilot_cli` backend uses a GitHub Copilot subscription and OAuth login instead of a separate model API key.
4. Which services to enable: `bridge`, `realtime`, `daily`, and `qr`, plus schedules.
5. File-transfer download directory, friendly machine names, SSH config aliases, and optional path-prefix mappings. Do not ask for passwords or private keys in chat.
6. For QR publishing: local clone directory, repository-relative target image, branch, commit message, and reminder text.
7. Whether to copy old JSON state files into the new private `state/` directory.

## Feishu and GitHub setup

In Feishu Open Platform, enable long-connection event delivery and subscribe to:

- `im.message.receive_v1`
- `card.action.trigger`

Grant the app the message receive/send permissions needed by those events, publish the app version, and add the app to the target chat where applicable.

Use a fine-grained GitHub token restricted to the configured repositories when possible. Monitoring requires repository metadata, issues, pull requests, comments, and contents read access. PR description updates additionally require pull-request write access. Classic tokens generally need `repo` for private repositories or `public_repo` for public-only access.

## Install

1. Install Node.js, Python 3, Git, rsync, and optionally pnpm. For high-quality PR descriptions without a separate API key, install the official GitHub Copilot CLI (`npm install -g @github/copilot` or `brew install --cask copilot-cli`) and run `copilot login` once.
2. Clone this repository to a stable location.
3. Run `automation/bin/install.sh`. The first run creates the private directories and copies the example only when no private config exists.
4. Edit `~/.config/kian-automation/config/config.json`, replacing the values required by each enabled service. Placeholders may remain in disabled or unused optional features. Keep QR disabled if unused. `bridge`, `realtime`, and `daily` are enabled by default in the example; QR is disabled. For `summarization.backend: "copilot_cli"`, set `command` to the absolute path returned by `command -v copilot` and keep `model: "auto"` unless a specific supported model is required. The OAuth credential remains in the local credential store and must not be copied into this repository.
5. Run the installer again. It installs bridge dependencies, renders `~/Library/LaunchAgents/com.kian.{bridge,realtime,daily,qr}.plist`, validates them, and reloads enabled services. If placeholders remain, it safely renders but does not load services.
6. Run `automation/bin/doctor.sh`.

The installer preserves an existing private config. Service enablement and schedules come from `services` in that config.
Dependency installation explicitly ignores inherited desktop proxy settings, which prevents a stopped local proxy application from breaking bootstrap.
After a standard service is loaded successfully, the installer removes its legacy predecessor (`com.kian.copilot-bridge`, `com.kian.github-monitor`, `com.kian.github-monitor-daily`, or `com.kian.reminder-qr`). This prevents old and new monitors with independent state files from sending the same GitHub update twice.

The PR manager invokes Copilot CLI non-interactively without tools, repository access, MCP servers, or custom instructions; only the serialized final PR diff is supplied. Because `launchd` does not inherit an interactive shell's `PATH`, the private config should use the CLI's absolute path. On a new Mac or after OAuth expiry, run `copilot login` interactively and rerun the installer. The legacy `openrouter` backend remains available only when its private `api_key` and model are explicitly configured.
PR descriptions default to concise, outcome-focused bullets without a fixed count. Each bullet covers one coherent, independently understandable change; unrelated changes stay separate rather than being packed together. This standard applies to regular text commands and card buttons; only explicit `full` mode retains additional implementation and validation details.

## PR description policies

The existing `descN` / `upN` commands and card buttons now use a remembered per-PR policy. In automatic mode, an empty description is generated from the final diff. A non-empty description with no matching Kian generation snapshot, or a description edited since that snapshot, enters **preserve** mode; this decision remains sticky. Historical descriptions without reliable records are preserved conservatively. Detection uses local history, not language or writing style; state must be migrated with the automation when moving machines.

Preserve mode uses the diff from the saved head to the current head and updates related existing items in place. Only independent new changes get a separate bullet in the appropriate existing section; no Incremental Updates or other incremental-only section is created. Unrelated paragraphs, validation/coverage records, TODOs, and end-to-end alignment sections remain intact. Change scope is refreshed separately. Historical validation gets a note identifying the head where the description was observed, without claiming that its tests cover new commits. The first run without a saved baseline conservatively reconciles the current PR diff. An unchanged head skips generation. A diverged baseline or possibly truncated compare diff stops without overwriting; ask the agent to inspect and re-establish the baseline. `simple` / `full` buttons do not override a preserve policy.

Tell the service agent “preserve the human description for #610”, “switch #610 to full rewriting”, or “restore automatic detection for #610”. The agent can persist the setting with:

```bash
python3 automation/scripts/pr_desc_manager.py policy610 world-sim-dev/magicore preserve
# Replace preserve with rewrite or auto as needed.
```

Policy changes do not rewrite GitHub immediately. Subsequent buttons inherit the setting. Explicit `rewrite` opts back into full final-diff generation. Existing records and human edits are not a substitute for checking newly generated claims: paragraph anchors protect unrelated content mechanically, while identifying relevant semantic edits still uses the configured model. The manager rechecks the body/head before writing and serializes local operations per PR; GitHub does not provide an atomic body/head compare-and-swap here.

## Verify and operate

`doctor.sh` checks macOS, Node/Python, JSON validity, reports unresolved placeholder counts, config permissions, runtime directories, plist validity, launchd registration, and log presence without printing secrets. The installer validates required fields separately for each enabled service.

Manual non-sending checks can use Python compilation and Node syntax validation. Running monitor/reminder commands may send real Feishu messages. File transfer usage is:

- `python3 automation/scripts/file_transfer.py local-file example-machine:/remote/path`
- Add `--into-dir` when the destination is a directory.

Remote endpoints use private SSH config aliases. Remote-to-remote copies stage through a local temporary directory and verify files by size and SHA-256.

To initialize the standard scratch area for a local or remote repository workspace, run `python3 automation/scripts/init_tmp_workspace.py example-machine:/workspace/path`. The workspace must already exist. The command idempotently creates `.tmp/` with `.tmp_cache`, `.tmp_chats`, `.tmp_configs`, `.tmp_data`, `.tmp_libs`, `.tmp_logs`, `.tmp_notes`, `.tmp_patches`, `.tmp_scripts`, `.tmp_tests`, and `.tmp_worktrees`, and ensures `.tmp/.gitignore` contains `**` so scratch contents are not tracked. Existing directories and files are preserved. Remote paths use the same configured machine aliases and container-to-host path mappings as file transfer.

For recurring Git alias maintenance, configure `git_alias_sync` privately and run `python3 automation/scripts/sync_git_aliases.py --commit-message "feat: update git aliases"`. The command validates the Bash script, optionally commits and pushes its source repository, and copies it to every configured target with size and SHA-256 verification. It never executes the setup script: it prints local and container-side `bash` commands for the operator to copy into each desired container. Source repositories, machine names, and target paths remain private configuration.

To recover from a stale VS Code Remote-SSH host cache, pass the pasted output or even a truncated `vscode-ssh-host-<hash>` fragment to `python3 automation/scripts/cleanup_remote_ssh_cache.py '<pasted-output>'`. The helper accepts at least eight hexadecimal hash characters, removes only matching direct child directories from the standard Remote-SSH cache root, and reports the directories actually removed. Reload the VS Code window before reconnecting.

To diagnose a slow remote VS Code workspace while the slowdown is happening, run `python3 automation/scripts/diagnose_vscode_remote.py --host <ssh-alias> --workspace <path>` and add `--container <name>` for a Dev Container. It measures data round-trip latency inside one warmed SSH session, remote CPU/memory/pressure, VS Code server and extension processes, recent error logs, and shared-storage metadata plus an automatically removed 8 MiB read/write/fsync probe. The result ranks evidenced root causes and reports an inconclusive sample instead of guessing when no threshold is exceeded.

Dev Container session migration is also included. Use `automation/scripts/migrate_vscode_copilot_sessions_macos.py` on the Mac to merge Copilot Chat History one workspace at a time; it requires an exact SSH host and workspace path and must only write after VS Code has fully exited. Use `automation/scripts/migrate_codex_sessions_between_containers.sh` on the remote Docker host to transfer container-level Codex history once per container pair. The Codex target must be empty; a non-empty target fails closed. Detailed recovery and safety instructions are in the repository-root `automation.md`.

For a recurring wheel mirror, configure `wheel_sync.profiles` privately and run `python3 automation/scripts/sync_wheels.py <profile>`. Each configured dist directory must contain exactly one wheel, which is treated as the current stable build and must match the corresponding ordered `expected_distributions` entry. There are no development profiles or version locks. Before transfer, the synchronizer compares source and per-destination SHA-256 values, skipping unchanged distributions entirely, including downloads and cleanup. Changed wheels are staged once and verified after every transfer. Only after a new wheel is uploaded and verified are other versions of the same distribution removed from that target. Digest comparison also detects same-name rebuilds.

QR publication is explicit: `python3 automation/scripts/qr_update_publish.py /absolute/path/to/image`. It copies the image, commits if changed, clears proxy variables, pushes the configured branch, marks the reminder complete only after a successful push, and sends a receipt.

### Automatic recovery of stale Codex writer locks (optional)

Manual recovery also examines retained frontend log sessions (up to 8 MiB per renderer log) to recover older connection identities. Only live windows in the latest session supply active ownership. On Linux, deleted remote log files can still be identified and read through the extension host's open `/proc/<pid>/fd` handles. Unreadable backend/connection evidence is reported as `backend_log_or_connection_unavailable`, not silently treated as a healthy workspace.

Current operational policy: automatic recovery is disabled. When the user says “清锁”, the agent runs `python3 automation/scripts/codex_lock_guard.py --manual --apply`. This one-shot command works with the automatic service disabled and scans the current `codex_activity_monitor.targets` registry in parallel, falling back to recovery targets if absent. Exact `thread_workspaces` mappings are supported. `--manual` alone previews. Fresh consecutive checks replace the background 60-second confirmation wait; the idle-turn, 120-second quiet-period, connection, single-thread and pidfd gates below remain. Unreachable or unverifiable targets are reported, not forcibly cleared. Signal delivery and candidate disappearance do not establish UI recovery; switching chats may still be required. The user only needs the natural-language trigger.

Enable `services.codex_lock_guard.enabled` in private configuration and list each target's `id`, SSH `host`, optional `container`, remote `codex_home`, `server_root`, and exact `workspaces` allowlist under `codex_lock_guard.targets`. Reinstall to register `com.kian.codex_lock_guard`, which checks every 60 seconds. Addresses and personal paths stay private. The macOS frontend supplies VS Code connection evidence; Linux targets verify locks. SSH uses `BatchMode`; password-only hosts require an existing SSH master, without storing or entering a password.

All gates must pass: local VS Code logs show the old connection is no longer used by any current window and a replacement connection exists; the replacement backend's last resume outcome for the thread is an active-writer conflict without a later success; the exact allowlisted thread lock belongs to an older extension app-server in the same mount namespace; that backend holds only this thread's writer lock; the last turn is finished, its rollout has been unchanged for at least 120 seconds, and no child task is running. Identical evidence must persist across consecutive scans spanning at least 60 seconds. Network/check failures reset confirmation; observation restarts after recovery.

Immediately before acting, the guard rechecks frontend ownership, lock inode, process start identity and task state, then uses a Linux pidfd to send only `SIGTERM` to that backend. It never sends `SIGKILL`, unlinks locks, edits databases/history/plugins, or changes reconnect timeouts. It does not perform global process cleanup. Unknown evidence, active tasks, multi-thread owners, unsupported versions or log formats are skipped. This is conservative recovery, not an upstream lifecycle fix; delayed state and check/action races still carry residual risk, and not every lock can be recovered automatically.

Run `python3 automation/scripts/codex_lock_guard.py` for a preview; `--apply` accumulates observations and releases eligible writers. The first scan never terminates a process. Private audit records live in `logs/codex-lock-guard-audit.jsonl`, with observations in `state/codex-lock-guard.json`. Audit `skips` explain rejected cases, while `waiting_confirmation` counts candidates still awaiting continuous confirmation. SSH errors include an exit code or timeout classification without credentials. Locks or processes already released by VS Code are identified separately. Sleeping Macs, stopped VS Code, and unavailable SSH prevent recovery until checks resume.

This service automates lock release, not unattended UI recovery. Codex may stop retrying after its first failed resume and retain the locked notice even after a later release. Switch chats and return after release to retry without closing the window. `ui_retry_may_be_needed` flags that possibility after a signal; an empty `actions` list does not prove that no conflict exists or the UI recovered. Active tasks, observation gates and SSH outages can delay recovery; reconnecting does not guarantee immediate access. Diff/Webview hangs are outside its scope.

Disable the private service flag and reinstall, or stop it immediately with `launchctl bootout gui/$(id -u)/com.kian.codex_lock_guard`. A replacement computer needs its own SSH setup and target paths; Linux/Python must support pidfd signaling. Old PIDs and lock observations are never migration authority.

## Upgrade

Pull the new repository code, review example/schema changes without overwriting the private config, then rerun `automation/bin/install.sh` and `automation/bin/doctor.sh`. The repository can move only if the installer is rerun, because rendered plists contain the repository location. Alternatively set `KIAN_REPO_ROOT` when launching the bridge manually.

## Uninstall

Run `automation/bin/uninstall.sh`. It unloads and removes only the four managed plist files. It intentionally preserves private config, state, and logs. Delete `~/.config/kian-automation` manually only after making any desired backup.

## Optional state migration

After stopping old services, copy only required JSON checkpoints into `~/.config/kian-automation/state/`, for example monitor state, daily stamp, managed PRs, QR reminder state, or bridge connection state. Do not copy old configs or logs. Set private files to mode `600`, rerun the installer, and validate with the doctor.

### Codex workspace completion notifications

Enable `services.codex_activity_monitor.enabled` and configure `codex_activity_monitor.targets` with a unique `id`, display `label`, SSH `host`, optional `container`, `codex_home` and exact `workspaces` allowlist. Reinstall to register `com.kian.codex_activity_monitor`; `services.codex_activity_monitor.interval_seconds` defaults to 60. It only observes non-archived chats named `Kato ...` in the allowlist. Register new workspace/host/container paths explicitly; SSH uses BatchMode and existing credentials/control masters.

The collector opens remote `state_*.sqlite` and `thread_history_*.sqlite` in SQLite read-only/query-only mode, reads public final messages, and tracks explicit turn statuses. It does not resume a thread, read reasoning, send agent instructions, release locks or kill processes. Only the latest turn can be considered working; orphaned historical inProgress rows are ignored. First successful discovery baselines old completions and tracks the current running turn. Later turns that start and finish between polls are also captured. A quiet/disconnected backend is not considered complete. Completed, failed and interrupted turns receive distinct Feishu cards; a completed turn is not a guarantee that the entire user goal or background job succeeded.

State and a durable pending outbox live at `state/codex-activity-monitor.json`, protected by a process lock and atomic writes. SSH failures retain checkpoints; Feishu transport/API errors retain pending cards and retry without needing a new completion. Stable target/thread/turn keys prevent normal replay across restarts, and the same Feishu UUID is reused for retries (Feishu deduplicates it for one hour). This is not an unlimited exactly-once guarantee after an ambiguous send/crash beyond the server window. Local Mac sleep, loss of network or SSH control-master expiry delay observation and delivery until the next successful poll. No night-time batching is applied to these explicit work-completion notifications. SQLite format changes are logged as unavailable, never treated as successful completion.

Use `python3 automation/scripts/codex_activity_monitor.py --dry-run` to inspect target/working counts without changing notification checkpoints or sending cards. Logs are `logs/codex-activity-monitor.log` and `.err.log`. Disable the service flag and reinstall, or use `launchctl bootout gui/$(id -u)/com.kian.codex_activity_monitor`. Notification cards contain the workspace identity, timestamps, status, turn ID and at most 600 characters of the agent's final reply (long replies keep the first 200 and last 395 characters, separated by `\n...\n`); no LLM-generated success assertion is added.

Before every send or retry, the monitor reads fresh user-message sequence metadata from that same remote chat. If a user message follows the completed agent reply, the obsolete pending card is dropped and stays deduplicated. It does not read the user reply text. Failed freshness checks defer delivery; already delivered messages are not recalled, and the remote check/send is not atomic.

`codex_activity_monitor.response_grace_seconds` defaults to 300: hold each notification for five minutes from the turn's completion timestamp, then recheck whether the user has replied before sending. With the normal 60-second poll, delivery is usually 5–6 minutes after completion. Waiting cards survive restarts; retrying does not restart the grace period. If the completion timestamp is missing, a persisted first-observation timestamp supplies the grace period instead.

Turns with a known execution duration strictly below 60 seconds are discarded before delivery, including failures, interruptions and already-queued retries. Duration uses `completed_at - started_at`, excluding the response grace period and offline delay. Exactly 60 seconds remains eligible. Missing or invalid timestamps do not establish a short turn and retain the existing notification policy.

When an existing Codex thread executes outside its VS Code workspace root, an optional target `thread_workspaces` map binds an exact thread ID to its registered workspace path. Every mapped destination must also appear in `workspaces`. This preserves narrow thread selection without treating an unrelated execution directory as a workspace. The collector retains `session_cwd` separately and never modifies Codex history.


### Rest-day notification gate

`work_calendar` gates only its selected `services` (normally `supplement`, `public_watch`, `qr` and `github`). Weekends stay quiet by default (`weekends_off: true`), including statutory makeup Saturdays/Sundays; set it false to follow official makeup workdays. Mainland China statutory holidays come from the cited State Council schedule in `work_calendar.py`, currently covering **2026**. Add and verify each newly published year's schedule before that year starts; an unknown year holds selected notifications and logs `WORK_CALENDAR_DEFERRED`, rather than guessing. Per-date, per-service `overrides`, e.g. `{"2026-10-31": {"public_watch": true}}`, override the day decision but do not bypass existing quiet hours.

The optional `schedule_calendar` connects the separately verified shared work schedule (for example, “大小周”). Exact configurable `work_title_patterns` / `rest_title_patterns` read expanded instances: a “工作日” mark can enable a Saturday, an explicit rest mark suppresses a weekday, and unrelated activities are ignored. With no marker use the baseline weekday/weekend rule; never infer alternating-week parity. Contradictory markers or unreadable calendars defer sending. Personal leave and statutory holidays still suppress a scheduled workday unless the user supplies a date/service override.

Personal leave uses the explicitly verified personal `feishu_calendar.calendar_id`, expanded event instances and configurable anchored `leave_title_patterns`. Any matching leave overlapping the day suppresses that whole day, including partial-day leave; cancelled/declined entries and ordinary meetings do not count. Private or custom-title leave that is absent from this calendar or does not match the configured patterns cannot be inferred. Decisions are cached for 15 minutes; only date, boolean and check time are cached, not event text. Inaccessible details/API/auth errors hold these notifications instead of treating unreadable calendars as no leave. Supplement occurrences on rest days are skipped, without later replay. Public repository/blog scans and deduplication continue; only sending is gated, retaining the durable queue for normal workday delivery from 10:30, at most one 25-item card per existing five-minute retry point.

Saul's application identity may discover a personal calendar with only `free_busy_reader` access, even after application API scopes are granted. Reading personal leave therefore uses the recipient's OAuth user identity. The agent runs `python3 automation/scripts/feishu_calendar_auth.py begin`, gives the official verification URL to the user, then runs `complete` after consent. These request calendar read-only and offline renewal, validate the authorized user matches `feishu.open_id`, and store mode-600 credentials privately in `state/feishu-calendar-user-token.json`; never commit/share tokens. Feishu may return additional scopes already authorized to Saul; this service only calls calendar-read endpoints and the identity check. A process lock protects rotating refresh tokens; auth is maintained on rest days too. Move to a new Mac or an expired/revoked grant requires a new consent flow. Enabling app scopes does not grant access to private calendar contents. Verify actual user-calendar `owner`/`reader` access before enabling `feishu_calendar`; never change calendar sharing/ACLs to make it public.

When the user supplies an nsys filename **prefix**, replace the initial `profile` in `profile_iter(...)_n0.nsys-rep` with that prefix and do not append the automatic job tag. For example, prefix `cpu_sync_work0` gives `cpu_sync_work0_iter(6-8)_n0.nsys-rep` in Downloads. This is the agent naming convention; the transfer CLI continues to take an explicit destination path.


### Owned repository and QR delivery on working days

`github` applies the same personal leave/work schedule gate to owned-repository realtime and daily cards. Realtime scans continue during `00:00–09:59` Beijing time and rest days, but append full rendered events to `github-monitor-state.json` under `deferred_updates`, atomically with the checkpoint/PR heads. These deferred events never flush as daytime realtime cards: the next eligible 10:00 daily summary includes them even when older than its normal 24-hour overview. Daily and realtime use the same process lock. Daily sends retain failed batches, use stable per-batch Feishu UUIDs (server deduplication is time-limited), and only clear successfully delivered queued events. A large backlog drains one card per five-minute retry, at most ten deferred events and about 18 KB Markdown per card; the normal overview is not repeated across continuation cards. Final daily success is stamped only after the backlog drains. Daily headings support `github.language` (`zh`/`en`). Realtime delivery outside quiet/rest periods keeps its existing behavior.

The daily LaunchAgent retains its 10:00 trigger and additionally checks every five minutes; the script refuses sending before 10:00 or on rest days, and a completed daily stamp suppresses later repeats. QR reminders (`qr`) keep their 12:00 schedule and seven-calendar-day round cadence. A rest day leaves pending/completed round state untouched; an outstanding or newly due round starts/reminds at the next working day's normal trigger rather than being discarded.

Holiday-source limitation: the verified “大小周” API data contains work/activity markers, not statutory holiday events (checked against National Day and New Year ranges). The [official Feishu Calendar FAQ](https://open.feishu.cn/document/server-docs/calendar-v4/calendar-faq) explicitly says OpenAPI does not directly provide statutory working-day/holiday queries. Do not claim that client holiday labels were read through this API. Keep the separately verified official annual holiday table until a genuine readable holiday calendar is identified and validated; do not remove the fallback based on UI labels alone.
